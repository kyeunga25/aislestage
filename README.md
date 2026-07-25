# AislePack — AI 電商素材工作台

一個以 React、Cloudflare Workers 與 Agents SDK 建立的電商 Campaign Pack 工作台。它把有權使用的商品圖片、已核實的商業資料及人工批准結合成協調一致的 1:1、4:5、9:16 素材流程。

An ecommerce Campaign Pack workspace built with React, Cloudflare Workers, and the Agents SDK. It combines an approved product image, verified commercial facts, and explicit human approval before generation.

Campaign Agent 會檢查資料、建立固定三比例計劃並等待使用者批准。商品外觀及精確商業文字仍以 product-preserving、deterministic 的方式處理，不交由圖片模型自由重畫。

## Architecture

- React, Vite, and TypeScript frontend.
- Cloudflare Worker API and static assets.
- D1 through the `DB` binding.
- Private R2 assets through the `MEDIA_BUCKET` binding.
- Asynchronous jobs through the `GENERATION_QUEUE` binding.
- Workspace-scoped planning and approval state through the `CAMPAIGN_AGENT` binding.
- Swappable copy and image provider interfaces.

Start with [the unified product specification](docs/PRODUCT_SPEC.md), then use [the beta access contract](docs/BETA_ACCESS.md), [the engineering brief](docs/CODEX_AGENT_BRIEF.md), and [the public release status](docs/TODO.md) for implementation details.

## Local development

```bash
git clone <REPOSITORY_URL>
cd marketing_image_ai_web
npm ci
npm run dev
```

The development UI can use local demo data. Workers integration tests use isolated D1, R2, and Queue bindings and must not contact production resources.

## Verification

```bash
git diff --check
npm run check
npm test
npm run build
npm run cf:dry-run
```

## Cloudflare configuration

Keep these binding names stable because application code depends on them:

```text
DB
MEDIA_BUCKET
GENERATION_QUEUE
CAMPAIGN_AGENT
ASSETS
```

Public examples must use explicit placeholders:

```text
<WORKER_NAME>
<D1_DATABASE_NAME>
<D1_DATABASE_ID>
<R2_BUCKET_NAME>
<QUEUE_NAME>
<DEAD_LETTER_QUEUE_NAME>
<PUBLIC_APP_URL>
```

Store account-specific identifiers in ignored local configuration or protected CI/Cloudflare settings. Do not replace placeholders with realistic-looking sample identifiers.

For an authorized deployment, copy the public structure to the ignored `wrangler.local.jsonc` file and populate it from protected deployment records. `npm run cf:deploy`, `npm run cf:migrate`, and `npm run cf:secrets` deliberately use that ignored file; `npm run cf:dry-run` validates only the public-safe template.

Set provider credentials with Wrangler secrets or the equivalent protected deployment setting. `.env.example` lists names only and must never contain real values.

Before deploying:

1. validate the selected private deployment configuration;
2. apply reviewed migrations to the intended environment;
3. run the Wrangler dry-run command;
4. confirm that registration, generation, and other high-cost capabilities use deliberate server-side gates;
5. deploy only after the target account and resource mappings have been independently verified.

## Security and privacy

- Protected APIs require an authenticated session.
- Workspace access is checked server-side.
- Closed, invite-only, and open registration are separate server-side modes; production defaults to closed.
- Suspended or deactivated accounts cannot create or continue sessions.
- Uploaded and generated assets remain private by default.
- Provider keys are Worker-side secrets and are never exposed to the browser.
- SQL values are bound parameters.
- Uploads, provider responses, asynchronous retries, and external events require validation and bounded processing.

Security-sensitive changes should include regression tests without publishing customer data, deployment identifiers, or non-public operational details.
