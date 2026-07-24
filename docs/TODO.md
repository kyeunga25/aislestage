# Public release status

The current product, interface, Agent, and architecture contract is maintained in [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md). This page records only capabilities and checks present in the repository.

## Implemented capabilities

- [x] Authenticated sessions and workspace authorization for protected operations.
- [x] Closed-registration and generation gates enforced by the Worker.
- [x] Workspace-scoped private product-image upload and authorized preview routes.
- [x] MIME allowlisting, file-size limits, and PNG/JPEG/WebP signature checks.
- [x] One persistent Campaign Agent instance per authenticated workspace.
- [x] Bounded 1:1, 4:5, and 9:16 planning with revision-aware human approval.
- [x] Client-side Agent state mutation disabled.
- [x] Queue delivery and usage-accounting idempotency covered by integration tests.
- [x] Deterministic local provider behavior for tests and demos.
- [x] Responsive dashboard views for Campaign Packs, products, brands, and assets.
- [x] Traditional Chinese and English campaign copy presentation.

## Public verification contract

- [x] Type checking, Workers integration tests, and production builds are available through npm scripts.
- [x] Wrangler dry-run validates the public-safe binding structure.
- [x] Protected route, cross-workspace, stale approval, upload, and generation-gate tests are included.
- [x] Account-specific identifiers and resource mappings are excluded from the tracked configuration.
- [x] Public examples use explicit placeholders instead of realistic infrastructure values.
- [x] Logs and error responses are designed not to expose credentials or full user assets.

Deployment state, private infrastructure mappings, customer information, and non-public business or operational material are intentionally not recorded in this repository.
