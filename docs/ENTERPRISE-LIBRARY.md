# Project library and account governance

This R7 continuation adds project organization, reusable saved designs and personal audit portability within the existing owner/editor/viewer architecture. It does not introduce a separate organization tenant or enterprise identity provider.

## Library behavior

- Project owners can assign a folder label of up to 80 characters, archive/restore a project and mark a project as a template. Editors and viewers can read these labels but cannot change them.
- The dashboard filters accessible projects by name/type/folder, active/archive/template status and owned/shared access. Destructive delete controls appear only for owners; the existing server owner check remains authoritative.
- Archive is a library state. The design, existing member permissions, revisions and share links remain usable. It is not a retention policy or access revocation.
- Using a template or duplicating a project requires authenticated read access to the source. The saved design and dimensions are copied to a new project owned by the caller, with revision zero. The payload is decrypted using the source owner's authenticated encryption context and re-encrypted using the new owner's context.
- Photos, member permissions, share links, revisions, locks, operation logs and library labels stay with the source. The new copy is active, unfiled and not itself designated as a template. Element IDs within the design are preserved because their references are local to each project.
- Template designation does not publish a project. Team members can use templates through their existing project access; anonymous share-link access does not authorize project duplication.

The advertised Free-plan allowance of one active owned project is now enforced consistently on project creation, duplication and archive restoration. Shared projects do not consume this allowance. Active Pro/Studio subscriptions permit unlimited projects; a null paid-plan expiry preserves accounts with no expiry, while an explicit past expiry uses the Free allowance. Existing projects above the allowance are retained. The count and write occur in one synchronous SQLite transaction. Owners can archive a project to free a library slot without deleting its design.

## Audit browsing and exports

`GET /api/audit` retains the existing `events` response and additionally supports `action`, `from`/`to` Unix-second filters, `beforeId` and `snapshotId`. Each request is restricted to the active session's user ID. Pages use decreasing unique IDs, a fixed snapshot upper bound and at most 200 events. Malformed dates, limits and cursors are rejected; timestamps are inclusive and the UI interprets date filters as UTC days.

The audit screen loads 100 events at a time, handles request errors and exports matching snapshot events as CSV or JSON. Export is bounded to 10,000 events and can be cancelled. Larger results produce a `-partial` filename, a visible partial-export message and a JSON `truncated` flag. CSV cells are quoted and spreadsheet formula prefixes are escaped. JSON includes filter values, snapshot ID, event count and export bounds. Export files contain the caller's existing audit detail, IP addresses and user agents; they are downloaded locally through the existing download helper.

The log remains personal, best-effort application auditing. It is not an immutable compliance ledger, organization-wide activity feed, signed evidence bundle or backup of the database.

## Session and payment protections

Projects, secrets, payments and audit browsing reject sessions awaiting the second authentication factor. Existing collaboration and assistant endpoints already checked active session status.

The two-factor verification update now writes the schema's existing `last_seen_at` column instead of an absent `sessions.updated_at` column and refreshes the browser session cookie to the configured active-session lifetime. Profile changes, session management, password changes and two-factor setup/enable/disable require a completed active session. Login, pending-session verification/status and logout retain their existing flow. Other session writes were inspected against the schema. This is a narrow correction to the existing authentication flow, not a new identity integration.

The Razorpay webhook remains independent of browser session and CSRF tokens. Its exact JSON request bytes are retained by the existing bounded JSON parser and the webhook checks a SHA-256 HMAC with a length-checked constant-time comparison. A missing raw body or malformed signature fails closed in live mode. Paid events must identify a Razorpay payment record and a paid payment-link status; already-paid records are ignored. Demo webhook behavior remains unchanged. These edits do not configure a gateway or create real payments.

## Migration and inspection-only limitations

Payment completion and subscription activation now share a synchronous transaction, with an in-transaction status guard against duplicate completion. Unknown/free plan records cannot activate a paid subscription. Archive restoration re-reads its library state inside the quota transaction.

Three idempotent SQLite migrations add `folder`, `archived` and `is_template` columns with compatible defaults. No design, photo or revision payload migration is required.

Per the requested no-run constraint, the changes were reviewed as source text only. The app, lint/type checker, tests, build, database migrations, payment callbacks and browser behavior were not executed. Live migration compatibility, compiler results, quota concurrency, audit downloads and payment signature handling remain unverified until those checks are authorized.

Actual organizations, shared folder administration, seat billing, SSO/SAML/OIDC federation, tenant-wide audit retention and enterprise security certification remain separate integration work requiring corresponding infrastructure and configuration.
