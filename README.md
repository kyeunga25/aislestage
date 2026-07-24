# AislePack — AI 電商素材包

A React and Cloudflare Workers project for turning an approved product image and verified brief into coordinated ecommerce campaign assets.

The core workflow targets 1:1, 4:5, and 9:16 visuals with bilingual copy. Product-preserving composition and deterministic commercial text are preferred over asking an image model to reproduce exact packaging, prices, or claims.

## Architecture

- React, Vite, and TypeScript frontend.
- Cloudflare Worker API and static assets.
- D1 through the `DB` binding.
- Private R2 assets through the `MEDIA_BUCKET` binding.
- Asynchronous jobs through the `GENERATION_QUEUE` binding.
- Swappable copy and image provider interfaces.

See [the engineering brief](docs/CODEX_AGENT_BRIEF.md) for the public architecture contract and [the technical backlog](docs/TODO.md) for contribution-ready work.

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
- Uploaded and generated assets remain private by default.
- Provider keys are Worker-side secrets and are never exposed to the browser.
- SQL values are bound parameters.
- Uploads, provider responses, asynchronous retries, and external events require validation and bounded processing.

Security-sensitive changes should include regression tests without publishing customer data, deployment identifiers, or internal operational details.
