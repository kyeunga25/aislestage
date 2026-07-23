# AislePack — AI 電商素材包

Working product brand for a Cloudflare Workers MVP that is validating how one approved product image and verified brief can become a coordinated ecommerce Campaign Pack.

Public repository: https://github.com/kyeunga25/marketing_image_ai_web

For future Codex agents, start with:

- [AGENTS.md](AGENTS.md)
- [docs/CODEX_AGENT_BRIEF.md](docs/CODEX_AGENT_BRIEF.md)
- [docs/TODO.md](docs/TODO.md)

Closed-beta preview:

- https://motive-ecommerce-visuals.kyeunga25.workers.dev

Cloudflare resources:

- Worker: `motive-ecommerce-visuals`
- D1: `motive-beta` (`replace-with-protected-id`)
- R2: `motive-beta-assets`
- Queue: `motive-generation-jobs`

## Local development

```bash
npm install
npm run dev
```

The Vite UI runs in demo mode locally. The deployed Worker defaults to a safe preview mode: new registration is closed and AI generation is disabled until the real private image-input and three-ratio Campaign Pack pipeline passes validation.

## Sync on another machine

```bash
git clone git@github.com:kyeunga25/marketing_image_ai_web.git
cd marketing_image_ai_web
npm ci
npm run check
npm run build
npm run cf:whoami
```

Use `.env.example` as the local reference only. Production secrets must be set through `wrangler secret put` and should never be committed. To continue work from another Codex workspace, pull the latest branch first:

```bash
git pull --ff-only
```

## Cloudflare setup

1. Log in with `npx wrangler login`.
2. Apply database migrations locally and complete endpoint smoke tests.
3. Validate deployment config with `npm run cf:dry-run`.
4. Apply reviewed remote migrations with `npm run cf:migrate`.
5. Deploy the safe closed-beta preview with `npm run cf:deploy`.
6. Configure `OPENAI_API_KEY` with `npx wrangler secret put OPENAI_API_KEY` only when real generation is ready.
7. Change `GENERATION_MODE` to `enabled` only after private product-image input, coordinated three-ratio output, deterministic text, duplicate-delivery tests, and cost controls pass.

`REGISTRATION_MODE` and `GENERATION_MODE` are deliberately committed as `closed` and `disabled`. Do not enable public self-service by changing only the frontend. The Worker enforces both gates server-side.

Useful checks:

```bash
npm run cf:secrets
npm run cf:queue
curl -i https://motive-ecommerce-visuals.kyeunga25.workers.dev/api/health
```

The health endpoint returns boolean capability flags without exposing secret values. The app deliberately rejects Wonder webhooks until its merchant RSA key and exact event schema are configured. It never treats a success redirect as payment confirmation.
