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
  - Reads `GROUNDWORK_SERVER_ROLE` (`authority` or `secondary`).
  - Declares deployment authority endpoints and secret verification tokens.

### 2. Verified prepaid seat terms

Tenant paid capacity is derived from a matched receipt, never from a requested count, a demo confirmation, a plan selector, or legacy subscription metadata. Base capacity remains at most five seats, capped by a positive `ORGANIZATION_MAX_SEATS` deployment allowance. Earlier rows and audit history are preserved; unverified paid counts provide zero additional capacity.

The finite product is a **Standard prepaid Razorpay INR seat term**. Operators must configure `PAYMENTS_MODE=live`, a live `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `RAZORPAY_ACCOUNT_ID` (the exact `acc_...` webhook merchant identifier), plus `ORGANIZATION_SEAT_PRICE_INR_MINOR` (integer paise per seat per term, 100–100,000,000) and `ORGANIZATION_SEAT_TERM_DAYS` (1–365). No price or term is invented when configuration is absent; checkout reports `billing_unconfigured`.

A purchase replaces the paid seat count and starts a fresh configured term when the receipt is verified. **Any remaining previous paid days are forfeited.** The UI and request require explicit acceptance of this policy. Prorating, refunds, recurring charges, native provider subscription management, Enterprise pricing and PayPal tenant billing are outside this finite contract. Cancel/reactivate only record the end-of-term flag on an already verified unexpired term; they do not extend or restore expired capacity.

### 3. Durable checkout and receipt binding

- `tenant_billing_orders` retains immutable organization, initiating owner/session, scoped request digest, target count, base seats, unit price, amount/currency, term, merchant, expiry and subscription revision **before** provider creation. One open intent is allowed per organization. Maximum target plus base is 10,000 seats; each checkout is capped at INR 1,000,000, expires after two hours and must cover current membership. History is retained with an explicit 500-order capacity error.
- `POST /api/organizations/:id/billing/seats` accepts exactly `{idempotencyKey,targetPaidSeats,acceptTermReplacement:true}`, returns `{duplicate,order}`, and creates a hosted checkout. The same organization/key with divergent owner/count is rejected. Replaying a known intent returns its status without issuing another provider request.
- Lost or uncertain creation responses are retained as `creation_unknown`. They are never automatically retried; expired/uncertain/provider-paid mismatches require operator reconciliation. No refund or reconciliation grant is fabricated.
- `payment_receipts` uniquely binds both `(provider,receipt_id)` and the local payment/intent ID. The Razorpay handler verifies the HMAC over the exact raw request bytes, merchant account, immutable link/reference identity, consistent payment/order/link IDs, captured and fully paid state, exact integer amount/currency, non-partial payment, and zero refunded amount before a transaction can apply capacity. The current provider payload permits a raw order entity ID; it is normalized to the payment/link `order_...` ID.
- Within the receipt transaction, current organization owner, subscription revision, configured base capacity, member count and pending intent expiry are checked. A signed receipt that fails this binding is durably marked `requires_review`; it grants no seats. Browser mutations recheck active unexpired session and owner membership inside their write transaction; provider callbacks do not require a browser cookie.
- The accepted receipt, paid order, subscription period/revision and audit transition commit together. Duplicate delivery cannot extend the period or inflate seats. The paid term is anchored to the recorded verification timestamp, so retries keep the original start/end.

The old direct `billing/subscribe` grant and `/api/payments/create` organization field now return an explicit payment-required/tenant-checkout error. Demo confirmation is restricted to existing **personal demo** payments. Live payment availability never falls back to a demo provider. Personal PayPal confirmations require complete live configuration including `PAYPAL_MERCHANT_ID` and validate the matching order, purchase-unit owner/reference, merchant, completed final capture, exact amount/currency and unique receipt rather than accepting a top-level status alone.

### 4. Expiry, admission and cleanup policy

An unexpired verified active term supplies paid seats. At expiry, canceled, delinquent, or unverifiable rows supply base capacity only. `effectivePaidSeats`, `expired`, `hasVerifiedPayment`, `validEntitlement` and `overCapacity` are explicit response fields. Effective admission/write capacity is the minimum of entitlement and the owner's administrative `organizations.seat_limit`. Purchases retain that administrative limit; an owner raises it explicitly in settings after payment.

Current members and projects are never deleted on expiry. If membership exceeds effective capacity, reads and owner/admin billing/member cleanup remain available, while project payload changes and new member admission are blocked. Member admission and setting changes recheck current capacity within their SQLite transaction. Reducing membership restores writes once it fits capacity.

### 5. Client and retained history

OrganizationWorkspace displays the configured INR quote and term-replacement acceptance, pending hosted payment links, verified/uncertain/review statuses and manual billing refresh. It preserves an idempotency key across a lost create response rather than silently issuing a new charge. `GET billing` returns configuration, effective entitlement, subscription and the latest 50 intents/transitions with private no-store caching. No UI claims a seat purchase is complete before a matched receipt.

## Source validation and remaining deployment acceptance

This increment was inspected and edited only. **No app, test, build, lint, typechecker, provider, payment or native service was executed.** Earlier Phase 7 test-source expectations for free paid-seat updates and demo tenant activation are replaced with fail-closed expectations as part of integration; none have been executed. The existing database migration, webhook fixture compatibility, concurrent delivery, provider credentials/merchant onboarding, commercial terms/taxes and actual live payment acceptance remain unverified.

Provider field contracts were checked against primary documentation: [Razorpay Payment Links webhooks](https://razorpay.com/docs/webhooks/payment-links), [Razorpay standard Payment Links API](https://razorpay.com/docs/api/payments/payment-links/create-standard/) and [PayPal Orders v2](https://developer.paypal.com/docs/api/orders/v2/). Documentation supports source inspection and is not evidence of a successful payment or deployment.

