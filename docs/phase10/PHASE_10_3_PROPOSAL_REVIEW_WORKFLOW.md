# Phase 10.3 — Evidence and proposal review workflow

The organization dashboard exposes **Plant Proposals** for reviewing proposals that have been persisted through the authenticated proposal API. Evidence and proposal contract persistence remain separate from source metadata and do not call an AI provider.

## Review and apply

1. An organization `OWNER` or `ADMIN` creates a proposal against an active catalog. Proposal creation resolves every evidence reference in the same organization or VERIFIED global evidence. A proposal with unverified evidence stays in `NEEDS_REVIEW`.
2. Evidence is reviewed through its linked record in the proposal screen. Verification records reviewer, time, reason, and an audit event; the backend requires current organization authorization or the dedicated global curator permission.
3. A different organization `OWNER` or `ADMIN` approves or rejects the proposal with a required reason. Approval requires linked evidence to be VERIFIED and the proposal contract to remain structurally valid. Decisions and audit events are atomic; final decisions cannot be changed through this endpoint.
4. An approved proposal can be applied once to a catalog draft. `CREATE_DRAFT` creates the next draft version; `UPDATE_DRAFT` replaces the selected draft's proposed defaults, stage templates, edge requirements and parameter definitions. Applying again returns the same draft. `RESEARCH_ONLY` cannot be applied.
5. Applying a proposal does **not** publish a standard. The draft must pass the existing catalog validator and then be explicitly published by an authorized organization manager. Profile versions still require validation before zone assignment; zone activation remains authorized and idempotent.

The backend repeats organization authorization on every operation and records review/application audit events. Review reasons are retained in the proposal snapshot and audit log. This workflow does not establish scientific truth, perform literature retrieval, generate proposals, or control actuators.

## Routes

- `GET /api/organizations/:organizationId/plant-ai-proposals`
- `POST /api/organizations/:organizationId/plant-ai-proposals/:proposalId/approve`
- `POST /api/organizations/:organizationId/plant-ai-proposals/:proposalId/reject`
- `POST /api/organizations/:organizationId/plant-ai-proposals/:proposalId/apply`
- `POST /api/scientific-evidence/:evidenceId/verify`

This feature uses existing Phase 10.2 tables and enum states; it adds no database migration. The separate Phase 10.1B deployment prerequisites remain in [the idempotency deployment runbook](PHASE_10_1B_ZONE_IDEMPOTENCY_DEPLOYMENT.md).
