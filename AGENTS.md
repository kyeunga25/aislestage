# Contributor and automation guidance

This file defines repository-safe working conventions for contributors and coding agents.

## Safety rules

- Do not bulk-delete files or directories.
- Do not use recursive deletion commands such as `rm -rf`, `rmdir /s`, or `Remove-Item -Recurse`.
- If deletion is required, delete one explicit file path at a time.
- Never commit secrets, credentials, local environment files, build output, dependency directories, or generated Wrangler state.
- Treat existing uncommitted changes as user-owned. Inspect `git status -sb` before editing and do not overwrite unrelated work.

## Product scope

The project is a React and Cloudflare Workers application for creating coordinated ecommerce campaign assets from an approved product image and a verified commercial brief. The primary output is a multi-ratio Campaign Pack with deterministic commercial text and bilingual copy.

Keep the workflow focused on product fidelity, exact text, private assets, and repeatable multi-format output. Avoid turning the project into an unrestricted prompt tool or a general-purpose design editor.

## Architecture

- Frontend: React, Vite, and TypeScript.
- Runtime: Cloudflare Workers with static assets.
- Data: D1 through the `DB` binding.
- Private objects: R2 through the `MEDIA_BUCKET` binding.
- Async jobs: Cloudflare Queues through the `GENERATION_QUEUE` binding.
- AI and other external services are accessed behind provider interfaces.

Generic binding names and interfaces may be committed. Account identifiers, resource names, deployment URLs, and secret values must remain in protected deployment configuration.

## Engineering requirements

- Preserve product images and render exact commercial text deterministically where practical.
- Enforce authentication and workspace authorization on every protected operation.
- Keep R2 objects private and serve them only through authorized access paths.
- Validate upload type and size before accepting assets.
- Keep provider keys and webhook verification material out of frontend code and Git.
- Make asynchronous processing and usage accounting idempotent.
- Keep provider implementations swappable and provide local mocks for tests and demos.

## Repository map

- `docs/PRODUCT_STRATEGY.md` — public product and design principles.
- `docs/CODEX_AGENT_BRIEF.md` — public engineering overview and local setup.
- `docs/TODO.md` — public technical backlog.
- `README.md` — project setup and verification commands.
- `wrangler.jsonc` — Wrangler binding structure; do not commit account-specific values to a public branch.
- `migrations/` — D1 schema history.

## Common checks

```bash
npm ci
npm run check
npm test
npm run build
npm run cf:dry-run
```

Before handing off work, run the checks that match the change, inspect `git diff --check`, and explain any deployment assumptions without printing protected values.
