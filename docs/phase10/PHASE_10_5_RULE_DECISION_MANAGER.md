# Phase 10.5 — Rule Engine and Decision Manager

## Implemented workflow

`DecisionManagerModule` is connected to the existing MQTT telemetry processor. Valid, in-order telemetry is evaluated asynchronously after duplicate/out-of-order checks, so database evaluation does not delay Redis realtime processing. Evaluation runs only when the device's zone has an ACTIVE assignment whose profile version is VALIDATED, whose source catalog version is PUBLISHED, and which has an APPROVED rule-set version.

Organization OWNER/ADMIN users can create a versioned rule-set draft for that validated profile version. A different OWNER/ADMIN approves it. A later change is a new immutable rule-set version. The definition describes rules for the seven domains `irrigation`, `fan`, `valve`, `fertigation`, `climate`, `safety`, and `emergency`. Each condition names a telemetry sensor code, an operator, and a numeric Plant Standard parameter key. It cannot embed an arbitrary agronomic threshold: the comparison value and unit are resolved from the currently assigned profile and stage snapshot, and units must match exactly.

Rule evaluation checks telemetry timestamp, configured freshness window (bounded by the existing one-hour Redis TTL), required sensor completeness/finiteness/freshness, numeric standard parameter availability, and exact unit match. Results include candidates, explanations, stable reasons, a decision key and references to assignment, profile version and approved rule-set version. PostgreSQL stores decisions and append-only feedback. The decision key is unique by device, assignment, rule-set version and telemetry sequence (or timestamp where sequence is unavailable).

## Arbitration and safe mode

Explicit domain ranks reserve emergency above safety above ordinary domains; only ordinary domains use configurable priority (0–99). Normal candidates cannot override safety/emergency. Simultaneous safety and emergency candidates for one actuator, equal-rank opposing commands, or multiple actuator targets in one evaluation produce a conflict result instead of silently selecting an action.

The Manager checks device freshness/status and that each referenced actuator is enabled and belongs to the zone. A manual emergency-stop state is not represented by the current application, so it is `unknown`; any actionable candidate is therefore BLOCKED. The adapter is `DisabledActuatorCommandAdapter`, always returns `NOT_SENT`, and has no MQTT publish implementation. Existing manual `ControlCommandsService` and its response/acknowledgement/timeout lifecycle are unchanged. This Phase 10.5 code cannot operate hardware.

## API

- `POST /api/organizations/:organizationId/plant-profile-versions/:versionId/rule-sets` — create a validated rule-set draft.
- `GET /api/organizations/:organizationId/plant-profile-versions/:versionId/rule-sets` — inspect versions and approval state.
- `POST /api/organizations/:organizationId/rule-sets/:ruleSetId/approve` — second-person approval.
- `GET /api/organizations/:organizationId/decisions` — list recent dry-run, blocked and conflict results.
- `POST /api/organizations/:organizationId/decisions/:decisionId/feedback` — append ACCEPTED, REJECTED or OBSERVED feedback.

There is no new MQTT topic or payload. Evaluation consumes the existing `greenhouse/{greenhouseId}/{deviceId}/telemetry` contract. Existing `command`/`response` MQTT messages continue to serve only explicit manual actuator control. No automatic command is published.

## Deployment and outstanding prerequisites

The additive migration `20261028130000_phase10_5_rule_decision_manager` is required before deploying this API. It has **not** been applied. Use the approved deployment process: verify the exact target, review every pending migration, apply and verify schema, then deploy the API. Do not point it at an unverified or production database for test validation.

Full safety/actuation is not complete: product owners must specify a persistent manual-stop/interlock contract, hardware protection limits and device-state semantics; firmware/EMQX owners must verify an automatic command and acknowledgment contract, command deduplication semantics and recovery/timeout policy. Until those are reviewed and tested on isolated hardware, dry-run is the only enabled mode. No agronomic defaults, units or sensor mappings are supplied by this code.
