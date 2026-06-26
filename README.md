# Motive — 電商 AI 視覺 SaaS

Cloudflare Workers MVP for generating ecommerce visuals from a brand pack, product data and reference images.

For future Codex agents, start with:

- [AGENTS.md](AGENTS.md)
- [docs/CODEX_AGENT_BRIEF.md](docs/CODEX_AGENT_BRIEF.md)
- [docs/TODO.md](docs/TODO.md)

Production Worker:

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

The Vite UI runs in demo mode until Cloudflare resources are configured. The generation button remains usable locally, but production generation requires D1, R2, Queues and OpenAI credentials.

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
2. Apply database migrations with `npm run cf:migrate`.
3. Validate deployment config with `npm run cf:dry-run`.
4. Deploy with `npm run cf:deploy`.
5. Configure secrets: `npx wrangler secret put OPENAI_API_KEY` and `npx wrangler secret put WONDER_WEBHOOK_PUBLIC_KEY`.
6. Complete Wonder merchant onboarding and implement the account-specific RSA verification key and event mapping before enabling `/api/wonder/webhook`.

Useful checks:

```bash
npm run cf:secrets
npm run cf:queue
curl -i https://motive-ecommerce-visuals.kyeunga25.workers.dev/api/health
```

The app deliberately rejects Wonder webhooks until its merchant RSA key and exact event schema are configured. It never treats a success redirect as payment confirmation.
