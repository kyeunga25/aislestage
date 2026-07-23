# Codex agent instructions for Motive

This file is the first handoff document for any Codex agent working on this repository.

## Hard safety rules

- Do not bulk-delete files or directories.
- Do not use:
  - `del /s`
  - `rd /s`
  - `rmdir /s`
  - `Remove-Item -Recurse`
  - `rm -rf`
- If deletion is required, delete one explicit file path at a time.
- If bulk deletion seems necessary, stop and ask the user to delete manually.
- Never commit real secrets. `.env`, `.env.*`, `.dev.vars`, `node_modules/`, `dist/`, `tmp/`, `.wrangler/`, `.wrangler-home/`, `.DS_Store`, and generated `worker-configuration.d.ts` should not be committed.

## Read these before implementation

1. `docs/PRODUCT_STRATEGY.md` — current product thesis, narrow MVP, evidence gaps, and validation gates.
2. `docs/CODEX_AGENT_BRIEF.md` — architecture, current state, Cloudflare resources, and implementation constraints.
3. `docs/TODO.md` — ordered execution plan and acceptance criteria.
4. `README.md` — local setup, Cloudflare commands, deployment URL, and sync instructions.
5. `wrangler.jsonc` — Worker, D1, R2, Queue, static assets, and environment bindings.
6. `migrations/` — D1 schema history.

## Current product goal

Validate a focused Campaign Pack workflow for Hong Kong ecommerce merchants and small marketing teams. The first product outcome should turn one approved product image and verified commercial brief into coordinated 1:1, 4:5, and 9:16 assets plus bilingual copy.

Preserve the real product and render exact commercial text deterministically. The first version should stay focused: do not expand into a general prompt-based image generator, broad design editor, payment platform, or five independent workflows before the validation gates pass.

## Current stack

- Frontend: React + Vite + TypeScript.
- Runtime/deploy: Cloudflare Workers with static assets.
- Data: Cloudflare D1.
- Object storage: Cloudflare R2.
- Async jobs: Cloudflare Queues.
- AI providers:
  - Copy/prompt provider: `gpt-5.4-mini`.
  - Image provider: `gpt-image-2`.
- Deferred payment provider candidate: Wonder.

## Useful Codex skills, connectors, and tools

The exact tool list can change between Codex conversations. At the start of a new task, inspect available tools/skills first. If `tool_search` exists, use it to discover lazy-loaded MCP tools before assuming a connector is callable.

### Cloudflare development and deployment

Use these for Worker, D1, R2, Queues, static assets, secrets, deployment, and Cloudflare account checks:

- Skill: `cloudflare`
- Skill: `wrangler`
- Skill: `workers-best-practices`
- Skill: `cloudflare:cloudflare`
- Skill: `cloudflare:wrangler`
- Skill: `cloudflare:workers-best-practices`
- Connector/MCP namespace when available: `mcp__cloudflare_api`
  - `mcp__cloudflare_api.docs` — search current Cloudflare docs.
  - `mcp__cloudflare_api.search` — search Cloudflare OpenAPI operations.
  - `mcp__cloudflare_api.execute` — read/create/update Cloudflare resources via API.

Recommended Cloudflare workflow:

1. Read `wrangler.jsonc`.
2. Run `npm run cf:whoami`.
3. Use `mcp__cloudflare_api.docs` for current docs before relying on memory.
4. Use `npm run cf:dry-run` before deploy.
5. Use `npm run cf:deploy` only after checks pass.
6. Use `npm run cf:secrets` to verify secret names, not values.

### GitHub, commit, push, and PR workflow

Use these when committing, pushing, opening PRs, or checking repo state:

- Skill: `github:github`
- Skill: `github:yeet`
- Skill: `github:gh-fix-ci`
- Skill: `github:gh-address-comments`
- Connector/MCP namespace when available: `mcp__codex_apps__github`
  - `_get_repo`
  - `_create_pull_request`
  - `_get_users_recent_prs_in_repo`
  - `_fetch_pr_comments`

Recommended Git workflow:

1. Run `git status -sb`.
2. Inspect diffs before staging.
3. Stage only files relevant to the current task.
4. Do not stage unrelated user changes.
5. Run relevant checks.
6. Commit with a concise message.
7. Push only after verifying remote/branch.

### Frontend implementation and QA

Use these for React/Vite UI, responsive layout, visual polish, and browser testing:

- Skill: `build-web-apps:frontend-app-builder`
- Skill: `build-web-apps:react-best-practices`
- Skill: `build-web-apps:frontend-testing-debugging`
- Skill: `browser:control-in-app-browser`
- Tool search query examples:
  - `browser local vite inspect console screenshot`
  - `React Vite frontend testing browser`

Recommended frontend workflow:

1. Keep UI focused on ecommerce visual workflows, not generic prompt tools.
2. Run `npm run check` and `npm run build`.
3. Run local dev server when visual QA is needed.
4. Use browser tools to check console errors and mobile layout.

### OpenAI API and model integration

Use these for current OpenAI model/API behavior, structured outputs, image generation/editing, and pricing assumptions:

- Skill: `openai-docs`
- Tool search query examples:
  - `OpenAI image generation official docs`
  - `OpenAI structured outputs Responses API`

Important:

- Verify current official OpenAI docs before changing `gpt-5.4-mini` or `gpt-image-2` request shapes.
- Do not expose `OPENAI_API_KEY` to frontend code.
- Keep `CopyProvider` and `ImageProvider` swappable.

### Security, abuse, and privacy review

Use these when adding auth, upload, billing, webhooks, workspace isolation, or public launch controls:

- Skill: `codex-security:security-scan`
- Skill: `codex-security:security-diff-scan`
- Skill: `codex-security:threat-model`
- Skill: `codex-security:fix-finding`
- Skill: `turnstile-spin`

Recommended security focus:

- Auth/session cookie security.
- Workspace authorization on every protected API.
- R2 private object access.
- Upload content-type and file-size validation.
- Wonder webhook signature verification and idempotency.
- Credit ledger double-settle/double-release prevention.
- Abuse/rate limiting and Turnstile before public beta.

### Documents, pitch materials, and business planning

Use these when producing `.docx`, PDFs, pitch decks, financial sheets, or funding documents:

- Skill: `documents:documents`
- Skill: `pdf:pdf`
- Skill: `presentations:Presentations`
- Skill: `spreadsheets:Spreadsheets`

### Image and visual concept generation

Use these when creating visual references, product mockups, UI concepts, or marketing examples:

- Skill: `imagegen`
- Tool: `image_gen`

Existing visual reference:

- `design-reference.png`

### General tool discovery

If a requested connector or skill is not available in the current conversation:

1. Use `tool_search` if available.
2. Search for the exact capability name, for example `Cloudflare`, `GitHub`, `browser`, `OpenAI docs`, `security scan`.
3. If a specifically requested plugin/connector is missing and install tools are available, follow Codex plugin install rules.
4. If no tool exists, explain the blocker and continue with local files/CLI where safe.

## Common commands

```bash
npm ci
npm run check
npm test
npm run build
npm run cf:whoami
npm run cf:migrate
npm run cf:dry-run
npm run cf:deploy
npm run cf:secrets
npm run cf:queue
```

Health check:

```bash
curl -i https://motive-ecommerce-visuals.kyeunga25.workers.dev/api/health
```

## Worktree discipline

- Always run `git status -sb` before editing.
- Treat existing uncommitted changes as user-owned. Do not overwrite them unless explicitly asked.
- Stage only files related to the current task.
- Run relevant checks before handing off:
  - `npm run check`
  - `npm run build`
  - `npm run cf:dry-run` when Cloudflare config or Worker behavior changes.
