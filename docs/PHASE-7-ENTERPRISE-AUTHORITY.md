# Phase 7 — Enterprise Authority and Billing

## Overview
Phase 7 implements central multi-host authority, tenant-scoped paid-seat entitlements, idempotent subscription lifecycle transitions, and audit-logged organization administration for Groundwork.

## Architecture

### 1. Central Multi-Host Topology
Secondary application hosts forward API requests to a central authority host rather than attempting distributed multi-writer SQLite operations:
- **Central Authority Host** (`server/src/authorityServer.ts`):
  - Sole owner of the SQLite database (`groundwork.db`), local master keys, and file artifact storage.
  - Exposes `/api` endpoints with session authentication, CSRF tokens, and rate limiting.
- **Secondary Application Hosts** (`server/src/secondaryHost.ts`):
  - Run stateless HTTP reverse proxies forwarding incoming `/api` traffic to `GROUNDWORK_AUTHORITY_URL`.
  - Do not load local database files, preventing split-brain corruption across multi-host deployments.
- **Topology Configuration** (`server/src/topology.ts`):
  - Reads `GROUNDWORK_HOST_ROLE` (`authority` or `secondary`).
  - Declares deployment authority endpoints and secret verification tokens.

### 2. Tenant Entitlements & Subscriptions
Subscriptions and seat entitlements are scoped per organization tenant:
- **Schema** (`organization_subscriptions` in `server/src/db.ts`):
  - `organization_id`: Unique identifier referencing the organization.
  - `plan`: Subscription tier (`standard` with 5 base seats, or `enterprise`).
  - `status`: Subscription status (`active`, `past_due`, `canceled`, `unpaid`, `trialing`).
  - `base_seats`: Default included seats (standard: 5).
  - `paid_seats`: Additional purchased seats.
  - `total_seats`: Total allowable seats (`base_seats + paid_seats`).
  - `current_period_start` / `current_period_end`: Billing cycle timestamp bounds.
  - `cancel_at_period_end`: Flag indicating whether subscription cancels when the period ends.
- **Entitlement Evaluation** (`getOrganizationEntitlement` in `server/src/organization.ts`):
  - `seatsUsed`: Exact count of current active members in `organization_members`.
  - `effectiveTotalSeats`: If subscription is delinquent (`past_due`, `canceled`, `unpaid`), paid seats are withheld and total seats revert to `baseSeats`.
  - `canAddMember`: True only if not delinquent and `seatsUsed < effectiveTotalSeats`.
  - `seatsAvailable`: `max(0, effectiveTotalSeats - seatsUsed)`.

### 3. Idempotent Billing Transitions
All billing changes, seat adjustments, and payment webhook integrations execute through idempotent transitions:
- **Schema** (`billing_transitions` in `server/src/db.ts`):
  - `id`: Unique identifier.
  - `idempotency_key`: Client-supplied or payment-derived key.
  - `action`: Transition action (`seat_change`, `subscribe`, `renew`, `cancel`, `reactivate`, `payment_failed`, `expire`).
  - `previous_state` & `new_state`: Serialized JSON states.
  - `details`: Metadata including requesting user and payment amounts.
- **Transaction Safety** (`applyBillingTransition` in `server/src/organization.ts`):
  - Inspects `billing_transitions` table before executing mutation; returns `{ duplicate: true, entitlement }` if key was already applied.
  - Validates seat reduction constraints: cannot decrease seats below the number of members currently in the organization.
  - Automatically synchronizes `organizations.seat_limit` with new `total_seats`.
  - Writes audit events to `organization_audit` for full enterprise compliance.

### 4. Payment Integration
- `POST /api/payments/create` accepts optional `organizationId`.
- Payments are tagged with `organization_id` in the database.
- Payment completion (`markPaid` and webhooks) invokes `applyBillingTransition` using the payment order ID as the idempotency key, extending the tenant period and activating subscriptions without duplicate billing.

### 5. Client Integration & UI
- **Client API** (`client/src/lib/organizationApi.ts`):
  - `getOrganizationBilling(organizationId)`
  - `updateOrganizationSeats(organizationId, { idempotencyKey, targetPaidSeats, paidSeatsDelta })`
  - `subscribeOrganization(organizationId, { idempotencyKey, plan, periodDays })`
  - `cancelOrganizationSubscription(organizationId, idempotencyKey)`
  - `reactivateOrganizationSubscription(organizationId, idempotencyKey)`
- **Organization UI** (`client/src/pages/OrganizationWorkspace.tsx`):
  - Renders Enterprise Authority & Billing Card for organization administrators.
  - Visual indicators for plan tier, delinquency status, used vs total seats.
  - Interactive seat purchase controls with UUID-based idempotency keys.
  - Subscription plan switching controls (Standard vs Enterprise).
  - Real-time audit log of recent billing transitions.

## Verification
- Automated integration test suite in `server/test/api.test.ts` covers:
  - Default tenant creation and entitlement initialization.
  - Purchasing paid seats and seat calculation.
  - Idempotent deduplication of seat purchase requests.
  - Subscription plan upgrades.
  - Organization payment creation, demo confirmation, and automated transition application.
- TypeScript compilation and type checks (`npm.cmd run lint`) verified with zero errors.
