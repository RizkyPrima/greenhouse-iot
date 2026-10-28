# Phase 10.2 — Scientific Evidence and AI Proposal Contract

**Scope:** domain and validation contracts, additive persistence, and the first authorized evidence/proposal persistence services. This phase does not retrieve full text, call an LLM, apply proposals to catalog drafts, or control hardware.

## Scientific evidence

`ScientificEvidenceRecord` is a finding with provenance; a `ResearchSource` remains bibliographic/provider metadata. A source record by itself does not substantiate a plant parameter. Evidence records may link to `ResearchSource` by `sourceId`, but carry a contract snapshot so later source metadata changes cannot silently rewrite the finding.

Evidence fields use `EvidenceField<T>` with four explicit states: `VALUE`, `UNKNOWN`, `NOT_REPORTED`, and `NOT_APPLICABLE`. This avoids converting missing information into a factual value. Verification is a separate status (`UNKNOWN`, `UNVERIFIED`, `VERIFIED`), and quality is a separate assessment (`HIGH`, `MODERATE`, `LOW`, `NOT_ASSESSED`). The validator requires a retrieval timestamp, extraction method/timestamp, and either a registered source ID or canonical HTTP(S) URL. An unverified record can be structurally valid but receives review findings.

## Proposal snapshot

`PlantAiProposalContract` carries organization/catalog references, target intent, crop and system context, parameter definitions, defaults, stage templates, edge requirements, evidence references, findings, questions, optional provider metadata, timestamps, and workflow status. `PlantProposalParameter` retains the catalog-compatible parameter shape (`parameterKey`, `label`, `dataType`, `unit`, `valueSchema`) and adds applicability, evidence, uncertainty, review state, and distinct biological/hardware-safety fields.

The proposal is a review snapshot. It is not evidence of scientific validity, a catalog version, or a command to an edge device. Final catalog payload remains owned by `PlantCatalogVersion` and its existing publication validator. The enum documents contract states. The review, approval, and apply-to-draft workflow is implemented in [Phase 10.3](PHASE_10_3_PROPOSAL_REVIEW_WORKFLOW.md); approval does not bypass catalog publication validation.

## Deterministic validation

`validateScientificEvidence` and `validatePlantAiProposal` return `valid`, a readiness state, and structured findings. Errors/critical findings make the contract `INVALID`; warnings make it `NEEDS_REVIEW`; otherwise the result is `READY_FOR_REVIEW`. Readiness does not mean scientifically verified. Proposal validation rejects missing/unknown contract fields, malformed nested stage and environmental records, invalid enums/findings/references, duplicate keys, non-JSON edge metadata, and JSON Schema Draft 2020-12 or profile/stage configuration mismatches. Numeric ranges are supported only for simple numeric schemas with safely comparable bounds; unsupported complex numeric schemas produce an invalid-range finding. Units are compared exactly; no conversion is attempted. Biological recommendations outside hardware safety limits remain intact and produce a human-review warning.

Conflict findings are validated and preserved for review; the contract validator does not compare source findings to discover conflicts and does not average values. Readiness remains a structural result, not scientific approval.

The validator can check that cited IDs appear in the proposal's evidence-reference list. It cannot prove that an ID resolves to a stored evidence record, that the record is allowed for the proposal's organization, or that a ResearchSource URL/identifier is authentic. A persistence/application service must resolve evidence IDs and enforce organization/catalog/version authorization before accepting or applying a proposal.

## Persistence

The initial additive migration introduced:

- `plant_scientific_evidence`: a typed contract JSON snapshot, verification status, optional ResearchSource FK, and creator.
- `plant_ai_proposals`: organization, catalog and optional target-version FKs, workflow status, full reproducibility contract JSON, and creator.
- `plant_ai_proposal_evidence`: explicit many-to-many proposal/evidence links.

This keeps findings separate from bibliographic records and preserves input/output/provider/validation detail in the contract. The follow-up additive migration adds nullable organization scope for evidence, reviewer identity/time, database checks that keep scalar and JSON verification status aligned, and a composite catalog/version foreign key. The Phase 2 migration remains unchanged because its deployment state is unknown.

`PlantEvidenceService` creates organization evidence for OWNER/ADMIN members and global evidence for actors with the dedicated `SCIENTIFIC_EVIDENCE_CURATOR` platform permission. New evidence is always stored as `UNVERIFIED`; verification requires an explicit review reason, complete structured findings, an eligible reviewer, and an audit event in the same transaction. Research-source registry permissions do not grant scientific curator authority. Metadata-only extraction may be retained as an unverified candidate but cannot pass verification.

`PlantProposalsService` requires organization OWNER/ADMIN membership, an active tenant catalog owned by that organization, and (for `UPDATE_DRAFT`) a DRAFT version belonging to that catalog. It permits organization-owned evidence and VERIFIED global evidence; foreign-organization and non-verified global evidence are unavailable to the proposal. Proposal and evidence-link creation plus audit are atomic. A proposal is a snapshot only and does not modify or publish catalog records. Global catalogs remain unavailable through this tenant flow.

## Known limits and next phase

- Full-text evidence acquisition and claim extraction are not implemented.
- Verification requires an authorized service transition and records reviewer/time, but the scientific judgment remains human; the proposal review UI does not acquire documents/full text.
- Conflict detection is represented in findings, but identifying scientific conflicts requires retrieved evidence and a later comparison service.
- Edge requirements are checked only as JSON-compatible objects; their keys and capabilities remain opaque until actual firmware capabilities and a versioned config protocol exist.
- The database migration has not been run in this work. Check the intended database's migration state read-only before deciding whether the new follow-up migration can be applied.
