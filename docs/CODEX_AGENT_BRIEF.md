# Codex agent brief — ecommerce AI visual SaaS

This document is a compact but complete handoff for future Codex agents. It describes what the app is meant to become, what already exists, and how to continue building without drifting from the original product scope.

The current product strategy and validation gates are defined in `docs/PRODUCT_STRATEGY.md`. When this brief and an older implementation idea disagree, follow the strategy document.

## 1. Product positioning

`Motive` is currently a working codename for an ecommerce campaign-asset product. It is not a finalized public brand.

The product is intended for Hong Kong ecommerce merchants and small marketing teams. It should not be a generic “free prompt” image generator. The first outcome to validate is a Campaign Pack:

1. Merchant signs in.
2. Merchant uploads one approved product image.
3. Merchant enters verified product facts and a compact brand/campaign brief.
4. Merchant chooses a campaign intent or preset.
5. App generates scene/layout directions and structured copy.
6. App preserves the source product and adds exact commercial text with deterministic compositing.
7. App returns coordinated 1:1, 4:5, and 9:16 assets plus caption copy.
8. App privately stores results and records quality, latency, and cost evidence.

Primary target users:

- Hong Kong SME ecommerce merchants.
- Candidate design partner segment: Sham Shui Po computer / DIY PC / electronics merchants.
- First validation cohort: 5 merchants and at least 10 real products.

Initial UI languages:

- Traditional Chinese.
- English.

Japanese and mainland China deployment are future validation items, not MVP scope.

## 2. MVP workflow

The repository prototypes five output concepts:

1. Store main image.
2. Product detail page banner.
3. Promotional / campaign poster.
4. Meta image + caption ad.
5. Product packaging showcase.

They should not be treated as five equal MVP products. The first validation workflow is one Campaign Pack containing 1:1, 4:5, and 9:16 outputs plus bilingual copy. Detail banners and packaging showcases are deferred until the Campaign Pack passes the quality and repeat-use gates in `docs/PRODUCT_STRATEGY.md`.

Supported output ratios:

- 1:1
- 4:5
- 9:16
- 16:5 where appropriate for detail banners.

Important rendering rule:

Accurate text such as brand name, price, promotion, CTA, and legal claim should be handled by fixed layout / overlay logic wherever possible. Do not rely only on the image model to render exact Traditional Chinese, English, prices, or small product specs inside the generated image.

## 3. Explicit non-goals for MVP

Do not add these before the core product is stable:

- Generic prompt-only image generation UI.
- Arbitrary canvas editor.
- Pixel-level mask editing.
- Background removal.
- CSV bulk generation.
- Direct ad publishing.
- Automatic social posting.
- Shopify or WooCommerce OAuth import.
- Enterprise approval workflows.
- Multi-region China deployment.

These can be considered only after MVP metrics justify them.

## 4. Business model assumptions

Pricing model:

- Monthly subscription with included credits.
- Extra credit packs.
- No unlimited generation plan.


- Workflow.
- Output ratio.
- Quality tier.
- Variant count.
- Reference image count.
- Actual provider cost metadata when available.

Target launch economics:


Possible payment provider after validation:

- Wonder is the planned first PSP.
- Recurring subscription should use tokenized card payment.
- Local one-time methods such as FPS, PayMe, AlipayHK, WeChat Pay HK, Octopus, etc. are only for top-up credit packs where Wonder merchant settings support them.
- Entitlements must be driven by verified, idempotent Wonder webhooks. Never trust success redirect pages for credit issuance.

Current code deliberately rejects Wonder webhooks until account-specific RSA key and event schema are implemented. Do not prioritize payment integration before repeat-use, willingness-to-pay, and unit-cost evidence exist.

## 5. Current deployed Cloudflare state

Production URL:

- `https://motive-ecommerce-visuals.kyeunga25.workers.dev`

Cloudflare account:

- `kyeunga25@gmail.com`
- Account ID: `replace-with-protected-id`

Resources:

- Worker: `motive-ecommerce-visuals`
- D1: `motive-beta`
- D1 ID: `replace-with-protected-id`
- R2: `motive-beta-assets`
- Queue: `motive-generation-jobs`

Useful commands:

```bash
npm run cf:whoami
npm run cf:migrate
npm run cf:dry-run
npm run cf:deploy
npm run cf:secrets
npm run cf:queue
curl -i https://motive-ecommerce-visuals.kyeunga25.workers.dev/api/health
```

Required secrets before real generation:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put WONDER_WEBHOOK_PUBLIC_KEY
```

Do not commit secret values.

## 6. Current codebase map

- `src/App.tsx` — main app shell.
- `src/components/` — UI components.
- `src/components/AuthPage.tsx` — auth UI if present in current worktree.
- `src/lib/types.ts` — shared product/workflow/session types.
- `src/lib/workflows.ts` — five fixed workflow definitions.
- `src/lib/providers.ts` — provider adapters:
  - `CopyProvider`
  - `ImageProvider`
  - `BillingProvider`
- `src/worker.ts` — Cloudflare Worker API, auth/session endpoints if current branch includes them, generation queue producer/consumer, R2 image serving.
- `migrations/0001_initial.sql` — initial workspace/product/generation/payment ledger schema.
- `migrations/0002_auth_workspaces.sql` — auth/session/workspace membership schema if present.
- `wrangler.jsonc` — Cloudflare bindings and production config.
- `design-reference.png` — visual design reference.

## 7. Current implementation status to verify at start

Always inspect `git status -sb` first. At the time this handoff was written, there may be uncommitted local changes related to:

- Auth UI.
- Session handling.
- Workspace memberships.
- `migrations/0002_auth_workspaces.sql`.
- Generation list/image endpoints.

Do not assume these are committed. Verify before continuing:

```bash
git status -sb
npm run check
npm run build
```

If Cloudflare resources changed:

```bash
npm run cf:dry-run
```

## 8. Architecture invariants

Keep these boundaries:

```text
React UI
  -> Worker API
    -> D1 for users/workspaces/products/credits/jobs/payments
    -> R2 for private original/reference/output images
    -> Queues for async generation
      -> CopyProvider using gpt-5.4-mini
      -> ImageProvider using gpt-image-2
      -> R2 output write
      -> D1 credit settlement
```

Provider interfaces should remain swappable:

- `ImageProvider` for `gpt-image-2`.
- `CopyProvider` for `gpt-5.4-mini`.
- `BillingProvider` for Wonder.

Generation must stay asynchronous:

1. Validate session and workspace access.
2. Reserve credits in D1.
3. Insert `generations` row with `queued`.
4. Send queue message.
5. Queue consumer calls AI providers.
6. Store output in R2.
7. Update generation status.
8. Settle or release credits exactly once.

Idempotency is required for retries and webhook processing.

## 9. Security and privacy requirements

- Workspace isolation is mandatory.
- R2 objects must remain private.
- Never expose provider API keys to frontend.
- Use short-lived signed upload/download URLs or authenticated Worker endpoints.
- Every generation, image read, product read, and payment event must be scoped to the authenticated workspace.
- Store user-uploaded assets only when user confirms they have commercial usage rights.
- Add privacy policy, acceptable use policy, refund policy, content complaint process, account deletion, and asset deletion flows before public launch.

## 10. Implementation priorities

The next agent should prioritize in this order:

1. Review and stabilize the uncommitted auth/session/workspace work.
2. Add authorization, credit, and duplicate-delivery tests before remote migration or deployment.
3. Implement private R2 upload for one real product reference image.
4. Build the Campaign Pack pipeline with product-preserving composition and exact text overlays.
5. Replace demo results with real polling, output review, download, and quality feedback.
6. Record latency, failure reason, provider usage, and cost per successful pack.
7. Run a concierge beta with 5 design partners and at least 10 real products.
8. Add reusable brand/product persistence only when repeat usage demonstrates the need.
9. Harden credits and idempotency before charging users.
10. Defer Wonder integration and public-launch work until validation gates pass.

Detailed task breakdown is in `docs/TODO.md`.
