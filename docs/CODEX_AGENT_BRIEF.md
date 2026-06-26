# Codex agent brief — ecommerce AI visual SaaS

This document is a compact but complete handoff for future Codex agents. It describes what the app is meant to become, what already exists, and how to continue building without drifting from the original product scope.

## 1. Product positioning

Motive is a self-serve SaaS for Hong Kong and overseas SME ecommerce merchants.

The product should not be a generic “free prompt” image generator. Its core workflow is:

1. Merchant signs in.
2. Merchant creates or selects a workspace.
3. Merchant defines a brand pack.
4. Merchant enters product data and uploads product reference images.
5. Merchant chooses a fixed ecommerce visual workflow and channel ratio.
6. App generates structured copy/prompt with `gpt-5.4-mini`.
7. App generates/edit images with `gpt-image-2`.
8. App stores results privately in R2, records status/cost in D1, and lets the merchant download or reuse outputs.

Primary target users:

- Hong Kong SME ecommerce merchants.
- First design partner segment: Sham Shui Po computer / DIY PC / electronics merchants.
- Beta target: 20–30 merchants with online selling and social ad needs.

Initial UI languages:

- Traditional Chinese.
- English.

Japanese and mainland China deployment are future validation items, not MVP scope.

## 2. MVP workflows

All five workflows should stay in the product:

1. Store main image.
2. Product detail page banner.
3. Promotional / campaign poster.
4. Meta image + caption ad.
5. Product packaging showcase.

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

## 4. Business model requirements

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


Payment provider:

- Wonder is the planned first PSP.
- Recurring subscription should use tokenized card payment.
- Local one-time methods such as FPS, PayMe, AlipayHK, WeChat Pay HK, Octopus, etc. are only for top-up credit packs where Wonder merchant settings support them.
- Entitlements must be driven by verified, idempotent Wonder webhooks. Never trust success redirect pages for credit issuance.

Current code deliberately rejects Wonder webhooks until account-specific RSA key and event schema are implemented.

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

1. Stabilize auth/session/workspace access.
2. Apply and verify all migrations locally and remotely.
3. Build real product and brand pack persistence APIs.
4. Implement R2 reference image upload and authenticated download/image serving.
5. Wire frontend to real API state instead of demo-only state.
6. Complete generation polling/history and result display.
7. Set up OpenAI secrets and verify real generation with a small test set.
8. Harden credits and idempotency.
9. Implement Wonder webhook verification and entitlement ledger.
10. Add tests and deployment documentation.

Detailed task breakdown is in `docs/TODO.md`.
