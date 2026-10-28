# Phase 10.7 — AI Agronomy Recommendation and Expert Review

## Scope and existing data reuse

The Knowledge Base is composed from existing published `PlantCatalogVersion` parameter definitions and verified `PlantScientificEvidence` records. Recommendations require a tenant-owned Plant Profile, a `VALIDATED` profile version, one of its growth stages, and a `PUBLISHED` source standard. Evidence is retrieved only when it is verified, matches the catalog crop, matches the selected stage, and names a parameter present in the published catalog version. Evidence may be organization-owned or globally verified. This phase adds no Prisma model or migration.

The deterministic expert checks reuse the Plant Proposal contract validator and catalog JSON Schema validation. They reject malformed provider responses, parameter keys outside the published contract, citations outside the verified retrieval set, invalid value shapes, and evidence units that do not exactly match the catalog unit. No unit conversion or agronomic threshold is inferred. An AI candidate that is not an exact reported source value is retained only as a clearly marked proposal note, never written into the draft's parameter configuration. Numeric, same-unit source ranges with no overlap are marked as a conflict for human review. Profiles do not currently encode growing system, so that applicability is explicitly unknown and requires review.

## Provider configuration

The API supports an optional OpenAI-compatible chat-completions endpoint through these environment variables:

- `LLM_API_BASE_URL` — provider base URL, without the `/chat/completions` suffix.
- `LLM_API_KEY` — credential; keep it in the deployment secret store and never commit it.
- `LLM_MODEL` — provider model identifier.

All three are required to call the provider. When absent, the API returns `PROVIDER_NOT_CONFIGURED` and stores no generated text or proposal. If no matching verified crop/stage evidence exists, it returns `INSUFFICIENT_EVIDENCE` without calling the provider. Provider errors and malformed responses fail closed.

The provider receives only the selected crop/stage, published parameter schemas, and selected verified evidence summaries. It must return JSON recommendations that cite the supplied evidence IDs. Recommendation values are checked against the existing proposal contract before persistence.

## Workflow and safety boundary

`POST /organizations/:organizationId/plant-profiles/:profileId/recommendations` accepts a validated `profileVersionId` and one `growthStageId`. It creates a normal `PlantAiProposal` only after a configured provider returns a structurally valid response that passes expert contract checks. The established workflow remains mandatory: evidence verification → proposal review/approval → apply to catalog draft → catalog validation and publication. This endpoint does not mutate a published standard, activate an assignment, alter Decision Manager rules, or publish MQTT commands.

Parameters without usable recommendations remain unchanged in the draft snapshot and carry `INCOMPLETE_EVIDENCE` findings. Conflicts and uncertainty remain review items. The existing proposal list/review dashboard is the continuation point; the `/plant-ai-recommendations` screen exposes evidence, completeness, findings, provider availability, and the proposal link.

## Preparing the first recommendation in the website

1. In Plant Catalog, add only parameter definitions supported by the catalog contract. Use a stable key, label, actual measurement unit, `number` type where appropriate, and a Draft 2020-12 schema such as `{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "number" }`. Do not add `minimum` or `maximum` unless a trusted source justifies those bounds.
2. Publish the draft catalog version after its configuration and parameters pass validation.
3. On the Plant Profile page, create a draft version, adopt that published catalog version, ensure its growth-stage configurations validate, and validate the profile version. Existing validated versions remain pinned to their original source catalog version.
4. On `/plant-ai-recommendations`, record source metadata, a canonical URL, the actual crop/stage/parameter/unit, a quoted finding, and a page/table/section locator. Blank metadata is recorded as not reported; it is not guessed.
5. Evidence remains `UNVERIFIED` until an authorized owner/admin reviews the source and provides a reason. The AI page shows verification status and lists exclusion reasons such as crop, cultivar, stage, parameter, or unit mismatch.
6. Select the profile version and stage, then request a recommendation. No parameter definitions or no eligible verified evidence returns `INSUFFICIENT_EVIDENCE` and never creates a proposal. A generated proposal still requires independent human review and approval.

The organization evidence listing is `GET /organizations/:organizationId/scientific-evidence`; it is tenant-scoped and includes only verified global records. The website uses the same service contract for creating and explicitly verifying organization evidence. This flow does not create Research Source Registry entries; a source URL is valid provenance, while a registered `sourceId` may be supplied by callers that have access to the existing registry.

## Deployment and validation

No database migration is introduced by Phase 10.7. The pending Phase 10.5 and earlier migrations remain subject to the existing target verification and rollout runbooks. Configure the provider only in the API deployment environment; no provider secret is needed for build or local unit tests. E2E still requires a separately verified disposable database and must not be pointed at the development database.
