# Public technical backlog

This backlog contains engineering work suitable for public collaboration. Checkboxes describe repository state only; deployment state is verified separately and is not recorded here.

## Authentication and sessions

- [x] Require authentication for workspace, generation, and private output routes.
- [x] Use HTTP-only session cookies and store only a token hash in D1.
- [x] Cover registration gates, login, logout, expired sessions, and protected endpoints with integration tests.
- [ ] Expand session-lifecycle tests across timestamp formats, cleanup jobs, and boundary times.
- [ ] Add account- and source-aware authentication abuse controls with regression coverage.
- [ ] Add session-management controls for reviewing and revoking active sessions.

## Workspace isolation

- [x] Scope workspace and generation queries to the authenticated user.
- [x] Test cross-workspace list, create, and private-output access.
- [ ] Add reusable authorization helpers for future product and asset endpoints.
- [ ] Add role-transition and membership-removal tests before exposing multi-user controls.

## Upload validation and private assets

- [ ] Add an authenticated product-image upload endpoint.
- [ ] Allowlist supported image formats and verify file signatures.
- [ ] Enforce request and decoded-image size limits.
- [ ] Store originals under workspace-scoped private R2 keys.
- [ ] Preserve the original and create derived working assets separately.
- [ ] Record asset ownership and metadata in D1.
- [ ] Serve previews and downloads only after workspace authorization.
- [ ] Add asset retention and deletion flows.

## Asynchronous processing

- [x] Cover duplicate queue delivery and idempotent state transitions with tests.
- [ ] Add bounded provider response validation and failure classification.
- [ ] Add timeout, retry, and dead-letter recovery tests.
- [ ] Add structured operational logs that exclude credentials and user content.

## Testing and quality

- [x] Run type checking, Workers integration tests, and production builds in CI.
- [ ] Add frontend tests for authentication state transitions and account changes.
- [ ] Add browser-level tests for keyboard navigation, responsive layout, and critical flows.
- [ ] Add regression coverage for malformed JSON, oversized requests, and unsupported media.
- [ ] Add deterministic provider mocks for success, rejection, timeout, and retry behavior.

## Accessibility

- [ ] Verify labels, focus order, error announcements, and keyboard-only operation.
- [ ] Check color contrast and reduced-motion behavior.
- [ ] Test authenticated flows with automated accessibility tooling and manual keyboard review.

## Privacy and abuse controls

- [ ] Document data categories, retention periods, and deletion behavior.
- [ ] Add privacy-safe audit events for security-relevant actions.
- [ ] Add rate limiting and abuse challenges to anonymous high-cost surfaces.
- [ ] Ensure logs and error responses do not expose user content or infrastructure identifiers.
- [ ] Add content reporting and account/asset deletion workflows before broad access.

## Deployment verification

- [ ] Keep account-specific identifiers outside public tracked configuration.
- [ ] Document how protected CI or Cloudflare settings provide deployment mappings.
- [ ] Validate every configuration change with `npm run cf:dry-run`.
- [ ] Confirm migrations against an isolated environment before any reviewed remote application.
- [ ] Maintain a documented rollback procedure without publishing live resource mappings.
