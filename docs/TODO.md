# Motive implementation TODO

Use this as the main working checklist. Each phase should end with checks passing and a small handoff note.

## Phase 0 — Repo and environment hygiene

- [ ] Run `git status -sb` and identify existing uncommitted changes.
- [ ] Confirm whether auth/workspace changes are intended to keep.
- [ ] Run `npm ci` if dependencies are missing.
- [ ] Run `npm run check`.
- [ ] Run `npm run build`.
- [ ] Run `npm run cf:whoami`.
- [ ] Run `npm run cf:dry-run`.
- [ ] Confirm `.gitignore` excludes local/generated files:
  - `.env`
  - `.env.*`
  - `.dev.vars`
  - `node_modules/`
  - `dist/`
  - `tmp/`
  - `.wrangler/`
  - `.wrangler-home/`
  - `.DS_Store`
  - `worker-configuration.d.ts`

Acceptance:

- Clean understanding of worktree state.
- Build and typecheck pass.
- No local secret or generated artifact is staged.

## Phase 1 — Auth, session, and workspace foundation

- [ ] Finalize `users`, `sessions`, and `workspace_memberships` migration.
- [ ] Apply migrations locally.
- [ ] Apply migrations remotely with `npm run cf:migrate`.
- [ ] Implement/register verify endpoints:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/session`
  - `GET /api/workspaces`
- [ ] Use HttpOnly session cookie.
- [ ] Add password length validation and safe hashing.
- [ ] Ensure logout deletes current session.
- [ ] Ensure workspace access is checked server-side for all protected endpoints.
- [ ] Update frontend to show authenticated and unauthenticated states.

Acceptance:

- New user can register.
- User receives a workspace and starter credits.
- User can log out and log back in.
- Protected endpoints return `401` without session.
- User cannot access another workspace by changing `workspaceId`.

## Phase 2 — Brand pack and product persistence

- [ ] Add API endpoints:
  - `GET /api/brand-packs`
  - `POST /api/brand-packs`
  - `PATCH /api/brand-packs/:id`
  - `GET /api/products`
  - `POST /api/products`
  - `PATCH /api/products/:id`
- [ ] Store brand:
  - name
  - logo object key
  - colors
  - tone
  - forbidden words
  - default locale
  - common CTA
- [ ] Store product:
  - name
  - category
  - benefits
  - specifications
  - price
  - promotion
  - target channels
  - reference image object keys
- [ ] Replace demo-only form state with persisted state.
- [ ] Add basic empty/loading/error states.

Acceptance:

- User can create and reload brand/product data.
- Data is scoped to the current workspace.
- Refreshing page does not lose saved brand/product data.

## Phase 3 — R2 reference image upload and private asset serving

- [ ] Decide initial upload approach:
  - authenticated Worker upload endpoint for MVP, or
  - short-lived signed URL flow.
- [ ] Add file validation:
  - content type allowlist
  - max file size
  - max number of reference images per product
- [ ] Store original product references under workspace-scoped R2 keys.
- [ ] Store logo assets under workspace-scoped R2 keys.
- [ ] Add authenticated image retrieval endpoint or signed download endpoint.
- [ ] Ensure no public bucket access is required.
- [ ] Track image ownership in D1.

Acceptance:

- User can upload product references.
- Images are private.
- Another workspace cannot read the image.
- Generated outputs and originals use separate object key prefixes.

## Phase 4 — Real generation workflow

- [ ] Ensure `OPENAI_API_KEY` is configured with `npx wrangler secret put OPENAI_API_KEY`.
- [ ] Improve `CopyProvider` structured output:
  - image prompt
  - layout guidance
  - caption Traditional Chinese / English
  - hashtags
  - CTA
  - text overlay slots
  - safety/claim notes
- [ ] Improve `ImageProvider` to actually use reference images where supported by the selected image API.
- [ ] Split model-generated background/product scene from deterministic text overlay where needed.
- [ ] Add generation status polling on frontend.
- [ ] Display latest generation history.
- [ ] Add retry/regenerate/variant actions.
- [ ] Record provider usage/cost metadata where available.

Acceptance:

- Authenticated user can generate at least one image end-to-end.
- Queue changes status from `queued` → `processing` → `completed` or `failed`.
- Output is stored in R2.
- UI shows result from real API, not demo-only placeholder.
- Failure releases reserved credits exactly once.

## Phase 5 — Credit ledger hardening

- [ ] Replace fixed `CREDIT_COST = 2` with a configurable pricing table.
- [ ] Price by:
  - workflow
  - ratio
  - quality
  - variant count
  - reference image count
- [ ] Add ledger event types:
  - subscription_grant
  - topup_grant
  - reservation
  - settlement
  - release
  - refund
  - manual_adjustment
- [ ] Add idempotency keys for generation jobs.
- [ ] Ensure queue retries cannot double-settle or double-release.
- [ ] Add admin-safe manual adjustment path only if needed.

Acceptance:

- Credit balance remains correct across success, failure, timeout, duplicate queue delivery, and retry.
- Ledger is append-only.
- Every balance change can be traced to a ledger row.

## Phase 6 — Wonder billing integration

- [ ] Complete Wonder merchant onboarding and sandbox access.
- [ ] Confirm written details:
  - supported currencies
  - enabled payment methods
  - recurring card tokenization
  - webhook signing format
  - settlement timing
  - refund events
- [ ] Implement Wonder webhook RSA/signature verification.
- [ ] Add payment event idempotency.
- [ ] Add subscription state model.
- [ ] Add one-time credit pack fulfillment.
- [ ] Add refund/chargeback handling.
- [ ] Add subscription failed payment / grace period handling.

Acceptance:

- Webhook replay does not duplicate credits.
- Out-of-order events do not corrupt entitlement state.
- Success redirect alone never grants credits.
- Refunds and cancellations are reflected in subscription/ledger state.

## Phase 7 — UI workflow completion

- [ ] Polish authenticated dashboard navigation.
- [ ] Add saved projects/generation history page.
- [ ] Add brand pack page.
- [ ] Add product library page.
- [ ] Add output detail page with:
  - image preview
  - caption
  - hashtags
  - CTA
  - download button
  - duplicate project action
- [ ] Add ratio-specific previews for Meta and ecommerce channels.
- [ ] Add clear credit balance and estimated cost before generation.
- [ ] Add mobile responsive QA.

Acceptance:

- Merchant can complete the core flow in under 10 minutes:
  - sign in
  - create product/brand
  - upload reference
  - choose workflow
  - generate
  - download/copy output

## Phase 8 — Quality evaluation and beta readiness

- [ ] Build 30–50 real product test set.
- [ ] Include electronics/DIY PC products and other consumer goods.
- [ ] Evaluate:
  - product fidelity
  - text correctness
  - brand consistency
  - layout usefulness
  - cost per successful output
  - failure rate
- [ ] Create internal rubric and score each workflow.
- [ ] Track beta metrics:
  - first successful output time
  - template completion rate
  - download rate
  - cost per workspace
  - 30-day retention
  - refund reasons

Acceptance:

- Five workflows pass Traditional Chinese and English tests.
- Target ratios pass visual QA.

## Phase 9 — Public launch hardening

- [ ] Add privacy policy.
- [ ] Add acceptable use policy.
- [ ] Add refund policy.
- [ ] Add content complaint process.
- [ ] Add account deletion flow.
- [ ] Add asset deletion flow.
- [ ] Add user confirmation that uploaded assets are commercially usable.
- [ ] Add abuse/rate limiting.
- [ ] Add Turnstile or equivalent anti-abuse check where appropriate.
- [ ] Add structured logging and operational alerts.
- [ ] Add basic security review.

Acceptance:

- Platform can safely accept beta users.
- Abuse and billing edge cases have documented handling.
- Support/debug data exists without exposing user private assets.

## Phase 10 — Post-MVP expansion

Only start after beta data supports it.

- [ ] Shopify product import.
- [ ] WooCommerce import.
- [ ] CSV batch generation.
- [ ] Multi-user workspace collaboration.
- [ ] Agency workflow.
- [ ] Approval/brand-locking tools.
- [ ] Custom domain.
- [ ] AI Gateway observability if Images API compatibility is confirmed.
- [ ] Japanese localization validation.
- [ ] Separate mainland China deployment/payment/compliance plan.

Acceptance:

- Expansion is driven by beta demand, not speculative scope creep.
