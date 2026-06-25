# Motive — 電商 AI 視覺 SaaS

Cloudflare Workers MVP for generating ecommerce visuals from a brand pack, product data and reference images.

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
```

Use `.env.example` as the local reference only. Production secrets must be set through `wrangler secret put` and should never be committed. To continue work from another Codex workspace, pull the latest branch first:

```bash
git pull --ff-only
```

## Cloudflare setup

1. Create a D1 database named `motive-beta`, an R2 bucket named `motive-beta-assets`, and a Queue named `motive-generation-jobs`.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the D1 database ID.
3. Apply the initial migration: `npx wrangler d1 migrations apply motive-beta --remote`.
4. Configure secrets: `npx wrangler secret put OPENAI_API_KEY` and `npx wrangler secret put WONDER_WEBHOOK_PUBLIC_KEY`.
5. Complete Wonder merchant onboarding and implement the account-specific RSA verification key and event mapping before enabling `/api/wonder/webhook`.
6. Deploy with `npm run deploy`.

The app deliberately rejects Wonder webhooks until its merchant RSA key and exact event schema are configured. It never treats a success redirect as payment confirmation.
