# Engineering brief — ecommerce campaign assets

This public-safe brief introduces the repository to contributors. It intentionally excludes private deployment mappings, internal planning, customer details, financial assumptions, and provider-selection decisions.

## Product purpose

The application turns an approved product image and a verified commercial brief into a coordinated set of ecommerce assets. The primary workflow produces 1:1, 4:5, and 9:16 visuals plus Traditional Chinese and/or English copy.

Generative services may assist with scenes, backgrounds, layout suggestions, and copy. Exact product facts, prices, promotions, CTAs, and required claims should be rendered through deterministic, reviewable code.

## Technology overview

- React, Vite, and TypeScript for the web interface.
- Cloudflare Workers for the API and static-asset runtime.
- D1 for users, sessions, workspaces, jobs, and application records.
- R2 for private source and generated assets.
- Cloudflare Queues for asynchronous generation.
- Provider interfaces for copy, image, and optional external-service integrations.

```text
React UI
  -> Worker API
    -> D1 via DB
    -> private R2 via MEDIA_BUCKET
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
- `src/worker.ts` — Worker routes, authentication, authorization, queue processing, and private asset delivery.
- `migrations/` — D1 schema history.
- `tests/` — Workers integration tests.
- `wrangler.jsonc` — Wrangler bindings and deployment structure.

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
- `ASSETS` when supplied by the Workers static-assets runtime.

Do not rename these bindings during documentation cleanup. Account IDs, resource names, database IDs, deployment URLs, and secret values belong in ignored local configuration or protected CI/Cloudflare settings.

## Provider and mock behavior

`CopyProvider` and `ImageProvider` isolate external APIs from application logic. Tests should stub provider calls or use deterministic fixtures. The Vite development experience may use local demo data, but production code must never receive mock credentials or test-only access gates.

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
- Validate upload content type, size, ownership, and workspace path.
- Bind SQL values rather than constructing SQL from user input.
- Verify webhook signatures and process external events idempotently before enabling an integration.
- Apply abuse controls to anonymous authentication and upload surfaces.
- Avoid exposing internal deployment state through public documentation or logs.

## Contribution workflow

1. Run `git status -sb` and preserve unrelated work.
2. Make the smallest coherent change.
3. Add or update tests for behavior changes.
4. Run `git diff --check`, type checking, tests, build, and Wrangler dry-run when configuration or Worker behavior changes.
5. Keep account-specific configuration and generated files out of Git.
