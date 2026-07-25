# Engineering brief — ecommerce campaign assets

This public-safe brief introduces the repository to contributors. It intentionally excludes private deployment mappings, customer details, and non-public business or operational material.

The unified product, interface, Agent, and current release contract lives in [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md).

## Product purpose

The application turns an approved product image and a verified commercial brief into a coordinated set of ecommerce assets. The primary workflow produces 1:1, 4:5, and 9:16 visuals plus Traditional Chinese and/or English copy.

Generative services may assist with scenes, backgrounds, layout suggestions, and copy. Exact product facts, prices, promotions, CTAs, and required claims should be rendered through deterministic, reviewable code.

## Technology overview

- React, Vite, and TypeScript for the web interface.
- Cloudflare Workers for the API and static-asset runtime.
- D1 for users, sessions, workspaces, jobs, and application records.
- R2 for private source and generated assets.
- Cloudflare Queues for asynchronous generation.
- Cloudflare Agents SDK and one Durable Object instance per workspace for planning and approval state.
- Provider interfaces for copy, image, and optional external-service integrations.

```text
React UI
  -> Worker API
    -> D1 via DB
    -> private R2 via MEDIA_BUCKET
    -> CampaignAgent via CAMPAIGN_AGENT
    -> Queue via GENERATION_QUEUE
      -> CopyProvider
      -> ImageProvider
      -> private output storage
      -> idempotent state update
```

## Repository map

- `src/App.tsx` — application shell and authenticated workspace UI.
- `src/components/` — interface components.
- `src/lib/types.ts` — shared application types.
- `src/lib/workflows.ts` — bounded workflow definitions.
- `src/lib/providers.ts` — swappable provider interfaces and implementations.
- `src/lib/campaign-agent.ts` — bounded brief sanitization and deterministic planning.
- `src/agents/CampaignAgent.ts` — persistent plan, revision, and approval state.
- `src/worker.ts` — Worker routes, authentication, authorization, queue processing, and private asset delivery.
- `migrations/` — D1 schema history.
- `docs/BETA_ACCESS.md` — public-safe account, role, invitation, and beta testing contract.
- `SECURITY.md` — public security, privacy, and vulnerability-reporting boundary.
- `tests/` — Workers integration tests.
- `wrangler.jsonc` — public-safe Wrangler binding structure.

## Local development

Requirements:

- Node.js 22 or later;
- npm;
- Wrangler 4.x through the project dependency.

```bash
npm ci
npm run dev
```

Run the complete local verification set with:

```bash
npm run check
npm test
npm run build
npm run cf:dry-run
```

Local tests use isolated Workers, D1, R2, and Queue bindings. They must not contact production resources.

## Public configuration contract

Public examples must use explicit placeholders rather than realistic-looking identifiers:

```text
Worker                 <WORKER_NAME>
D1 database            <D1_DATABASE_NAME>
D1 database ID         <D1_DATABASE_ID>
R2 bucket              <R2_BUCKET_NAME>
Queue                   <QUEUE_NAME>
Dead-letter queue       <DEAD_LETTER_QUEUE_NAME>
Public application URL <PUBLIC_APP_URL>
```

The application code relies on generic binding names:

- `DB` for D1;
- `MEDIA_BUCKET` for R2;
- `GENERATION_QUEUE` for Queues;
- `CAMPAIGN_AGENT` for the workspace-scoped Campaign Agent;
- `ASSETS` when supplied by the Workers static-assets runtime.

Do not rename these bindings during documentation cleanup. Account IDs, resource names, database IDs, deployment URLs, and secret values belong in ignored local configuration or protected CI/Cloudflare settings.

Authorized deployments use an ignored `wrangler.local.jsonc` file or an equivalent protected CI configuration. The tracked `wrangler.jsonc` is a validation template and must not contain a live infrastructure mapping.

For Cloudflare Workers Builds, use `npm run check && npm test && npm run build` as the build command, `npm run cf:deploy:build` as the production deploy command, and `npm run cf:preview:build` when non-production versions are enabled. The deployment scripts accept only protected Cloudflare build variables, generate an ignored Wrangler file, and keep registration closed with deterministic Agent and generation modes. Repository selection, branch control, identifiers, resource names, tokens, URLs, and build history are external deployment state and must not be copied into public documentation.

## Provider and mock behavior

`CopyProvider` and `ImageProvider` isolate external APIs from application logic. Tests should stub provider calls or use deterministic fixtures. The Vite development experience may use local demo data, but production code must never receive mock credentials or test-only access gates.

`CampaignPlanningProvider` is optional. Deterministic mode must remain fully functional without a provider key. Assisted mode may refine the plan summary and rationales, but the fixed outputs, verified facts, and human-approval requirement remain server controlled.

Generation has a separate `GENERATION_MODE`: `disabled`, `deterministic`, or `assisted`. Deterministic mode composes the approved private product image and exact commercial fields into a private SVG without calling an external provider. Assisted mode may supply a background image, but it must use the same deterministic product and text composition step. The Worker must compare the submitted brief and revision with the current approved Agent state before reserving credits.

When adding a provider:

1. implement the existing interface;
2. validate and bound request and response data;
3. keep credentials in Worker secrets;
4. add deterministic failure and retry tests;
5. avoid logging user assets, prompts, credentials, or full provider payloads.

## Security and privacy principles

- Authenticate every protected API request.
- Authorize the authenticated user against the requested workspace.
- Keep R2 buckets private and retrieve objects through authorized Worker routes or short-lived signed access.
- Store only hashed session tokens server-side and use secure, HTTP-only cookies.
- Keep beta invitation tokens and bound invite emails hashed at rest, and enforce account status on login and session loading.
- Use one-way abuse keys rather than raw email or IP values in authentication-attempt records.
- Validate upload content type, size, ownership, and workspace path.
- Check both the upload MIME allowlist and file signature before writing a private product asset.
- Derive the Campaign Agent instance from the authenticated workspace; never accept an arbitrary instance name from the browser.
- Reject direct client state changes and stale plan approvals.
- Bind SQL values rather than constructing SQL from user input.
- Apply abuse controls to anonymous authentication and upload surfaces.
- Keep user-facing failures generic; do not return provider, database, object-storage, or queue diagnostics.
- Avoid third-party browser telemetry and font requests unless they are deliberately reviewed and documented.
- Avoid exposing private deployment state through public documentation or logs.

## Contribution workflow

1. Run `git status -sb` and preserve unrelated work.
2. Make the smallest coherent change.
3. Add or update tests for behavior changes.
4. Run `git diff --check`, type checking, tests, build, and Wrangler dry-run when configuration or Worker behavior changes.
5. Keep account-specific configuration and generated files out of Git.
