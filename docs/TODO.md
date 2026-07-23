# Product execution TODO

Use `docs/PRODUCT_STRATEGY.md` for the product thesis and validation gates. This checklist intentionally prioritizes evidence and a narrow Campaign Pack over a broad self-serve platform.

## Current worktree checkpoint

- [x] Identify the existing uncommitted auth/workspace changes.
- [x] Confirm TypeScript check and production build pass.
- [x] Confirm the Worker can complete a dry-run package.
- [x] Review the auth implementation and migrations as one coherent change.
- [x] Add automated tests before enabling real generation.
- [x] Verify Wrangler authentication for the approved preview deployment.

Acceptance:

- Existing user changes remain intact.
- No secrets or generated files are committed.
- Auth changes can be reviewed and tested independently from product experiments.

## Milestone 1 — secure closed-beta foundation

- [x] Test registration, login, logout, session expiry, and cookie settings.
- [x] Test that unauthenticated protected endpoints return `401`.
- [x] Test that one user cannot access another workspace or generation image.
- [x] Make credit reservation and release safe under failed requests.
- [x] Make queue settlement/release idempotent under duplicate delivery.
- [x] Apply migrations locally and run endpoint smoke tests.
- [x] Keep public registration and AI generation disabled in the deployed preview.
- [x] Commit auth/security work separately from later generation work.

Acceptance:

- A closed-beta user can enter and leave a private workspace safely.
- Authorization and duplicate-delivery behavior have automated coverage.
- No remote migration or deploy is required to prove the local result.

## Milestone 2 — real product asset input

- [ ] Add an authenticated upload endpoint for one product image.
- [ ] Allow only approved image content types and enforce a size limit.
- [ ] Store originals under workspace-scoped private R2 keys.
- [ ] Record asset ownership and metadata in D1.
- [ ] Create a normalized working asset without overwriting the original.
- [ ] Serve previews and downloads only through authenticated access.
- [ ] Add an explicit confirmation that the user has commercial rights to the upload.

Acceptance:

- A user can upload, preview, and reuse one real product reference.
- Another workspace cannot enumerate or retrieve that asset.
- The original is retained unchanged.

## Milestone 3 — Campaign Pack generation

- [ ] Replace separate workflow-first generation with one Campaign Pack entry point.
- [ ] Collect verified product facts, price, promotion, locale, colors, tone, and CTA.
- [ ] Offer a small set of campaign-intent presets rather than free prompting.
- [ ] Generate structured scene, layout, caption, and overlay instructions.
- [ ] Generate or edit backgrounds without redrawing exact product details where possible.
- [ ] Composite the approved product asset deterministically.
- [ ] Render product name, price, promotion, CTA, and claims with deterministic text.
- [ ] Produce coordinated 1:1, 4:5, and 9:16 outputs.
- [ ] Store provider usage, latency, error category, and estimated cost.

Acceptance:

- One real product produces a complete three-ratio pack and caption.
- Product-fidelity failures and text failures can be measured separately.
- Exact commercial text is not delegated to the image model.

## Milestone 4 — real result experience

- [ ] Poll generation state until completion or failure.
- [ ] Remove demo-result fallback from authenticated production behavior.
- [ ] Show all Campaign Pack ratios together.
- [ ] Allow download of individual assets and the complete pack.
- [ ] Add retry for failed technical jobs without double charging.
- [ ] Capture per-output feedback: usable, minor edit, major edit, unusable.
- [ ] Capture correction reason: product, text, layout, brand, claim, or other.

Acceptance:

- A merchant can complete upload to download without manual database work.
- Every result contributes quality and cost evidence.

## Milestone 5 — concierge validation

- [ ] Recruit 5 relevant design partners.
- [ ] Observe and document each partner's current creative workflow.
- [ ] Process at least 2 real products per partner.
- [ ] Record current time/cost, product type, requested channels, and revision count.
- [ ] Obtain permission before retaining or sharing any example.
- [ ] Ask for a concrete acceptable price or paid-pilot decision.
- [ ] Track whether the partner returns within 14 days.

Gate to continue:

- At least 10 products processed.
- At least 70% of selected outputs need no more than minor edits.
- Median time to first usable pack is under 10 minutes.
- At least 3 partners repeat or bring another campaign within 14 days.
- At least 3 partners provide a concrete price or paid-pilot commitment.

If these gates fail, narrow the supported product types, improve composition, or change the first customer segment before adding platform features.

## Milestone 6 — repeat-use productization

Start only after the validation gate passes.

- [ ] Persist reusable brand packs.
- [ ] Add a product library based on observed repeat behavior.
- [ ] Add generation history, duplicate campaign, and regenerate actions.
- [ ] Add a transparent cost estimate before generation.
- [ ] Replace fixed credits with a tested pricing table.
- [ ] Decide trial, subscription, and top-up structure from usage evidence.
- [ ] Implement payment only after the provider contract and webhook schema are confirmed.

Acceptance:

- Repeated creation is materially faster than the first campaign.
- Pricing is tied to measured cost and willingness to pay.
- Payment events are verified and idempotent before credits are issued.

## Deferred backlog

- Detail-page banner as a separate workflow.
- Packaging showcase as a separate workflow.
- Arbitrary canvas editor and pixel-level masking.
- Background-removal product line.
- CSV batch generation.
- Shopify or WooCommerce OAuth import.
- Direct ad publishing and automatic social posting.
- Multi-user and agency approval workflows.
- Public self-serve signup.
- Additional language and regional deployments.

Deferred items require evidence from multiple design partners, not only implementation convenience.
