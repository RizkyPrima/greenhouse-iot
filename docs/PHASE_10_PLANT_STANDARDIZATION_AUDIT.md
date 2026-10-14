# Phase 10.0 — Plant Standardization Audit

**Status:** Complete; read-only audit  
**Audit date:** 2026-10-14  
**Scope:** Current repository state at `D:\greenhouse-iot-phase6-auth\greenhouse-iot`  
**Code changes:** None. This report is the sole file created for the audit.

## 1. Executive summary

The repository has a usable multi-tenant greenhouse foundation: organizations contain greenhouses, greenhouses contain zones, and zones can be associated with devices, sensors, and actuators. Authentication and organization membership checks already provide patterns for tenant-scoped APIs. The telemetry pipeline validates basic payload shape, maintains realtime Redis state, persists history, and tracks direct actuator commands and acknowledgements.

Plant standardization itself is **not implemented** in the inspected application source. The Prisma schema has no plant/species/profile/version/growth-stage/parameter/assignment/activation models. There is no Plant API or dashboard route. No one of the seven named Rule Engines and no Decision Manager was found in `apps/api/src` or the ESP32 firmware. The current controller handles telemetry and direct operator actuator commands; it does not evaluate agronomic rules.

The best reuse point for a Phase 10 design is `Zone` as the physical assignment boundary, connected through `Greenhouse` to `Organization`. `Sensor.metadata` and `Actuator.metadata` are JSON metadata fields, not a validated plant-configuration system. `ControlCommand` audits device commands but is not a configuration-activation log. These must not be represented as existing plant features.

**Recommended Phase 10.1 scope:** agree and validate the tenant-owned plant-profile/version/stage/parameter domain and an immutable validated-version lifecycle, while reusing `Organization`, `Greenhouse`, and `Zone`. Keep rules and MQTT payloads unchanged in 10.1. Establish versioning, authorization, validation, and migration/backward-compatibility tests before implementing runtime decisions or edge distribution.

## 2. Evidence conventions and boundaries

- **Verified** means located in the current repository source/configuration/documentation inspected for this audit.
- **Proposed** means design guidance in this report, not implemented behavior.
- **Not found** means targeted source searches and repository inventory did not locate an implementation. It does not prove no external service exists.
- Project prompt documents describe intended architecture and planned routes. They are design material, not evidence that those features exist in the running code.

No database connection, migration, seed, firmware build, package install, build, lint, or test command was run. No application service was started or changed.

## 3. Repository structure and package manager

The actual project root is the nested `greenhouse-iot` directory. It contains `apps/api` (NestJS/TypeScript), `apps/web` (Next.js App Router/TypeScript), `firmware/esp32_s3_greenhouse`, `infrastructure` (Docker Compose, EMQX, PostgreSQL init), and `docs`.

The project directory contains separate `apps/api/package.json` and `apps/web/package.json`, each with its own `package-lock.json`; no project-root `package.json` or npm workspaces manifest was found. This is a monorepo by directory layout, with independently managed npm applications. A `package-lock.json` exists in the parent workspace directory, outside the specified project root; its role was not verified.

Key verified paths:

| Area | Paths |
|---|---|
| API composition | `apps/api/src/app.module.ts`, `apps/api/src/main.ts` |
| Persistence | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` |
| Auth/RBAC | `apps/api/src/auth/`, `apps/api/src/organizations/` |
| Greenhouse/zone | `apps/api/src/greenhouses/`, `apps/api/src/zones/` |
| Sensors/actuators/devices | `apps/api/src/sensors/`, `apps/api/src/actuators/`, `apps/api/src/devices/` |
| MQTT/telemetry | `apps/api/src/mqtt/`, `apps/api/src/telemetry/` |
| Web | `apps/web/src/app/`, `apps/web/src/lib/api-client.ts`, `apps/web/src/components/layout/sidebar.tsx` |
| Edge and broker | `firmware/esp32_s3_greenhouse/esp32_s3_greenhouse.ino`, `infrastructure/emqx/` |
| Documentation | `docs/`, root `README.md`, `Master Prompt Antigravity IDE #U2014 Greenhouse IoT Platform.md` |

The web routes currently include `/dashboard`, `/greenhouses`, `/devices`, `/realtime`, `/history`, `/settings`, `/login`, and `/register`. The sidebar has no plant-management link. Phase 9 mobile is not represented as a web/API application in the inspected tree, consistent with the instruction that it is skipped.

## 4. Current-state inventory

| Capability | Status | Evidence / observation |
|---|---|---|
| Organizations and membership | **FOUND** | `Organization`, `OrganizationMembership`, auth and organization modules |
| Greenhouses | **FOUND** | `Greenhouse` model and CRUD/list service/controller |
| Zones | **FOUND** | `Zone` model, greenhouse-scoped creation and list endpoints |
| Plant species/crop catalog | **NOT FOUND** | No model, API, client type, route, or source implementation found |
| Plant profiles | **NOT FOUND** | No profile model or Plant module/API |
| Profile versions/drafts | **NOT FOUND** | No version lifecycle or immutable configuration snapshot |
| Growth stages | **NOT FOUND** | No stage model or stage configuration |
| Plant parameter definitions/configurations | **NOT FOUND** | JSON metadata exists for sensor/actuator hardware only; no plant parameter schema or validator |
| Plant-to-zone assignment | **NOT FOUND** | Zones have no plant relation/assignment history |
| Configuration activation history | **NOT FOUND** | `ControlCommand` records physical actuator commands, not plant config activations |
| Seven Rule Engines | **NOT FOUND** | Targeted source search found no named irrigation/fan/valve/fertigation/climate/safety/emergency rule engines |
| Decision Manager / priorities | **NOT FOUND** | No arbitration/resolution service or decision-priority contract found |
| MQTT telemetry/status/commands | **FOUND** | Topic parser, MQTT service, telemetry processor, command service and firmware handlers |
| MQTT profile/config delivery | **PARTIALLY FOUND** | `config` is an accepted topic message type, but it is absent from default subscriptions and has no processor or firmware configuration handler |
| Local edge rules/config cache | **NOT FOUND** | Firmware reads/simulates sensor values and directly handles pump/fan/light commands; no plant profile or rule configuration cache |
| Web plant management | **NOT FOUND** | No plant route, API-client methods, types, or navigation item |
| Authentication and tenant membership | **FOUND** | Global JWT, roles, and resource-access guards; membership-based service filters |
| Audit trail for actuator commands | **FOUND** | `ControlCommand` captures actor, target/value, status, and timestamps; distinct from configuration audit |
| Phase 9 mobile app | **NOT FOUND / intentionally skipped** | No mobile application in inspected project tree |

## 5. Prisma models and relationship analysis

The current schema is `apps/api/prisma/schema.prisma`. Four migration directories were present: `20261001064817_init_phase_4_greenhouse`, `20261001073359_add_phase5_telemetry`, `20261002032900_add_phase6_auth_users_memberships`, and `20261012120000_complete_control_command_audit`.

### Existing reusable structures

| Model | Relevant fields and relationships | Constraints/indexes | Reuse assessment |
|---|---|---|---|
| `Organization` | `name`, unique `slug`, description, soft-delete timestamps; owns memberships and greenhouses | Unique slug | Reuse as tenant scope for organization-owned plant profiles |
| `OrganizationMembership` | `userId`, `organizationId`, `role`; belongs to user and organization | Unique `(userId, organizationId)`; indexes on both FKs | Reuse for tenant authorization |
| `Greenhouse` | `organizationId`, name, code, location, timezone, status; owns zones/devices | Unique `(organizationId, code)`; index organization | Reuse as parent context for zone assignments |
| `Zone` | `greenhouseId`, name, code, description, status, soft deletion; relates to devices, sensors, actuators | Unique `(greenhouseId, code)`; index greenhouse | Reuse as physical plant-assignment boundary; add a separate assignment/history relation rather than duplicate zone concepts |
| `Device` | `greenhouseId`, optional `zoneId`, globally unique `deviceId`, hardware/firmware/status/last-seen; sensors/actuators/telemetry/commands | Indexes greenhouse and zone | Reuse for device location and connectivity; no plant semantics |
| `Sensor` | `deviceId`, optional `zoneId`, `name`, `code`, `sensorType`, `unit`, `enabled`, optional `metadata Json` | Unique `(deviceId, code)`; indexes device and zone | Reuse as observed hardware/sensor catalog only. `metadata` has no plant parameter validation/version semantics |
| `Actuator` | `deviceId`, optional `zoneId`, `name`, `code`, `actuatorType`, `enabled`, optional `metadata Json` | Unique `(deviceId, code)`; indexes device and zone | Reuse for actuator capabilities only; metadata is not a rule configuration |
| `TelemetryRecord` | Device FK, MQTT device/greenhouse identifiers, sequence, received/processed timestamps, raw JSON | Unique `(deviceId, sequenceNumber)` and indexes device/greenhouse/received time | Reuse as telemetry evidence, not profile audit |
| `TelemetryValue` | Record FK, optional sensor FK, sensor code, numeric/string values, unit, timestamp | Indexes record, sensor, timestamp | Reuse for reading history; no agronomic bounds or stage context |
| `DeviceStatusLog` | Device MQTT/greenhouse identifiers, status and diagnostic values, optional raw JSON | Indexes device MQTT ID, greenhouse, receive time | Reuse for connection history only |
| `ControlCommand` | Unique command ID; device, optional actuator/user, command/target/value, status/result/error and lifecycle timestamps | Indexes device, actuator, user, command ID | Reuse as command-operation audit only. It cannot represent profile version activation or stage assignment |

### Missing domain structures

No Prisma models or equivalent normalized tables exist for plant species/types, reusable plant profiles, profile revisions, growth-stage definitions, parameter definitions/units/ranges, per-stage parameter values, plant assignments to zones, activation events, or config validation results. There are no corresponding Prisma enums or plant-specific unique constraints/indexes.

The relations `Device.zoneId`, `Sensor.zoneId`, and `Actuator.zoneId` are optional links to `Zone`; schema-level relations do not establish a plant assignment. The model also stores `Device.greenhouseId` separately from optional `zoneId`. The schema shown has independent FKs rather than a composite constraint proving that a device's zone belongs to its greenhouse. New assignment code should validate this invariant transactionally (and consider a database-level constraint if supported by the chosen schema approach).

### Proposed conceptual model — not implemented

Prefer a normalized, tenant-scoped, versioned domain rather than reusing hardware `metadata` JSON:

1. **PlantProfile**: owning organization (nullable only if the product explicitly supports immutable platform-curated profiles), display name, stable crop/species key, status, creator and timestamps. A species catalog can be a separate shared `PlantSpecies` table only if multiple profiles need common taxonomy; avoid duplicating species fields across profile versions.
2. **PlantProfileVersion**: profile FK, monotonically increasing version, lifecycle (`DRAFT`, `VALIDATED`, `ACTIVE` only if activation is profile-global; otherwise keep version validity separate from zone activation), schema version, immutable payload checksum, validation metadata, creator/time. Unique `(profileId, version)`.
3. **GrowthStage**: version FK, stage key/order, duration or entry/exit criteria, and stage metadata. Unique `(profileVersionId, code)` and `(profileVersionId, order)`.
4. **PlantParameterDefinition**: stable key, unit, value type, allowed range/enum and validation constraints; shared canonical definitions. Versioned parameters must reference a definition and record values per growth stage. Decide early which parameters are numeric versus categorical and how unit conversion is handled.
5. **GrowthStageParameter**: stage FK, definition FK, typed value/configuration (or a validated typed JSON payload if the parameter domain is intentionally extensible); unique `(growthStageId, parameterDefinitionId)`. Preserve min/max and operational guardrails explicitly rather than leaving them in opaque JSON.
6. **ZonePlantAssignment** (or planting/crop-cycle entity): zone FK, selected validated profile-version FK, selected stage FK, start/end times, status, actor and change timestamps. This preserves assignment history instead of overwriting the active crop state.
7. **ProfileActivation/Audit event**: append-only actor/action, profile and immutable version IDs, optional target zone/assignment ID, activation/deactivation times, validation/checksum snapshot and reason. Keep config activation separate from `ControlCommand`.

If plant-level parameter inheritance is required, define precedence (profile defaults → stage overrides → zone overrides) and persist the resolved configuration snapshot/hash used for a decision. Do not add arbitrary zone overrides until product governance and validation rules exist.

## 6. Authentication and current RBAC behavior

Verified roles in Prisma are `OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`, and `AI_AGENT`. `docs/phase6.md` describes OWNER/ADMIN/OPERATOR/VIEWER intent and says AI_AGENT is a future scoped identity. The code does **not** encode a numeric/inherited role hierarchy; `RolesGuard` checks explicit allow-lists on each handler. `AI_AGENT` is not automatically a higher or lower human role.

`AuthModule` registers global `JwtAuthGuard`, `RolesGuard`, and `ResourceAccessGuard`. `ResourceAccessGuard` resolves organization context from resource IDs/body fields and checks membership. Collection services often filter by the authenticated user's membership. Some route methods rely on these global guards plus service filtering rather than repeating a role decorator. `RolesGuard` also resolves org context from route/body identifiers when an endpoint has a `@Roles` allow-list.

Current explicit permissions found:

- `OWNER` and `ADMIN`: create/update/delete greenhouses, create greenhouse zones, manage devices/sensors/actuators, and update/delete zones/sensors/actuators.
- `OWNER`: organization member add/role changes and organization update/delete.
- `OWNER`, `ADMIN`, `OPERATOR`: send manual actuator command.
- Authenticated members: read/list existing organization resources subject to membership-scoped service queries and resource access checks.
- `VIEWER`: no explicit write route found in the listed resource controllers; reads follow authenticated-member scope.
- `AI_AGENT`: schema enum exists; no distinct plant/rule permissions found.

Collection read access is not equivalent to public access. New plant endpoints should always be tenant-scoped and should not rely only on a client-supplied organization ID. Add explicit handler allow-lists and service-side membership/resource checks.

### Proposed authorization matrix

| Action | OWNER | ADMIN | OPERATOR | VIEWER | AI_AGENT |
|---|---:|---:|---:|---:|---:|
| View profiles and versions in member organization | Yes | Yes | Yes | Yes | No by default; grant only scoped machine reads |
| Create/edit draft profile and parameters | Yes | Yes | No | No | No |
| Validate draft / create immutable validated version | Yes | Yes | No | No | No |
| Activate/deactivate a validated version for a zone | Yes | Yes | No | No | No |
| Assign an approved profile/stage to a zone | Yes | Yes | Yes (approved versions only) | No | No by default |
| Read zone assignment/history | Yes | Yes | Yes | Yes | No by default |
| Change shared platform catalog entries | Platform operator role outside current enum/tenant RBAC; define separately | — | — | — | — |

This matrix is a proposal. Product owners should decide whether operators may change stages, whether profile authorship is organization-only, and whether an AI_AGENT can propose (but never activate) configuration.

## 7. Rule Engine and Decision Manager findings

**Overall status: NOT FOUND in application source.** Targeted searches of `apps/api/src`, firmware, and `docs/` found no implementation of the named engines or manager. The root `Master Prompt Antigravity IDE #U2014 Greenhouse IoT Platform.md` does describe plant profiles, rule engines, emergency/safety behavior, `/plants` routes, and offline-first intentions (including around its sections 16–24), but that is intended design, not executable evidence.

| Requested engine | Status | Current evidence |
|---|---|---|
| Irrigation | NOT FOUND | No named engine or policy service; firmware exposes a pump relay and direct command handling |
| Fan | NOT FOUND | No fan rule engine; firmware supports direct fan relay commands |
| Valve | NOT FOUND | No valve rule engine; no valve relay alias found in firmware's command mapping |
| Fertigation | NOT FOUND | No engine, nutrient configuration, or dosing policy found |
| Climate | NOT FOUND | No climate decision module; telemetry readings are stored/served |
| Safety | NOT FOUND | No rule-engine safety evaluator/interlock found |
| Emergency | NOT FOUND | No emergency arbitration/override module found |
| Decision Manager | NOT FOUND | No priority ordering, conflict-resolution policy, or decision trace found |

Actual runtime is a telemetry ingestion path plus explicit manual control. `ControlCommandsService` maps supported actuator codes (pump/fan/light and Indonesian aliases), rejects unsupported targets, checks actuator enablement, checks device/broker availability, publishes an ON/OFF command, and correlates device response/timeout into `ControlCommand`. These are valuable safety/observability primitives, but not automatic rule evaluation or command arbitration.

Telemetry validation verifies object/array shape and string code/numeric JavaScript type, rejects empty sensor lists and timestamps more than one hour in the future. It does not validate finite values, per-sensor physical ranges, profile-specific thresholds, or stale profile configuration. Duplicate/out-of-order sequence detection is based on current Redis state. There is no profile/version identifier on decisions because there are no decisions or profiles.

## 8. MQTT and edge integration

### Verified contract

- Topic shape: `greenhouse/{greenhouseId}/{deviceId}/{messageType}` in `apps/api/src/mqtt/mqtt.constants.ts` and firmware `initTopics()`.
- Accepted parser message-type set includes `telemetry`, `status`, `event`, `alarm`, `command`, `response`, and `config`.
- API default subscriptions include telemetry/status/event/alarm/response, not `config` or `command`. API publishes commands outbound; firmware subscribes to its per-device `command` topic.
- Telemetry shape: `{ seq?, ts?, sensors: [{ code, value, unit? }] }`; firmware sends seq/time and temperature, humidity, soil moisture, and light sensor codes.
- Status shape includes online/offline/idle plus optional IP, RSSI, heap, uptime, firmware and timestamp. Firmware uses a retained QoS 1 LWT `{"status":"offline"}`; periodic status publishes are not retained. Telemetry uses PubSubClient publish; API default publish QoS is 0 and retain false unless overridden.
- Command payload from backend: `{ commandId, command: 'ON'|'OFF', actuator }`, published QoS 1 and non-retained. Firmware validates command fields and maps pump/fan/light. Response includes `deviceId`, `commandId`, `actuator`, `status`, `activeState`, `error`, `ts`; API correlates it to the originating command.
- Realtime state is Redis-backed with a one-hour device-key TTL. Status evaluation uses 15-second online / 15–30-second stale / over-30-second offline thresholds.
- EMQX ACL file documents backend broad greenhouse access, but Docker Compose allows anonymous connections/no-match allow for development and mounts ACL only as a commented option. Treat the Compose broker posture as development configuration, not production authorization proof.

`config` being accepted by the topic parser does not establish configuration delivery. The processor switch has no `config` case; default subscriptions exclude it; firmware declares no config topic and no local profile/rule cache. There is no version acknowledgment, checksum, rollback, or edge-side schema validation for plant parameters.

### Proposed boundary without changing contracts in Phase 10.1

Keep profile authoring, schema validation, version activation, tenant authorization, and the authoritative versioned plant state in the backend. Rule evaluation should also remain server-side until deterministic engine contracts and safety behavior are specified. Existing telemetry/command contracts can remain unchanged while the data model and authoring API are introduced.

Before any safety-critical offline operation, decide which rules must execute on-device. If some policy must run offline, distribute only a signed/validated, versioned snapshot and require edge acknowledgment, schema compatibility, freshness/expiry behavior, safe fallback, and activation trace. The existing `config` message-type string is only a potential compatibility hook, not a working transport. Any subscription or payload use of it requires a separately reviewed compatibility plan and tests; Phase 10.0 makes no contract changes.

## 9. Dashboard integration findings

Current Next.js App Router routes and sidebar navigation are in `apps/web/src/app/` and `apps/web/src/components/layout/sidebar.tsx`. `apps/web/src/lib/api-client.ts` wraps auth, organization, greenhouse, zone, device, sensor/actuator, telemetry, and health endpoints. Shared client data types are in `apps/web/src/types/index.ts`.

There are no Plant types or client methods. No `/plants` route or plant-management components exist. The current `/greenhouses` page already fetches greenhouses and zones and is a natural link to zone assignments. `/settings` manages organization membership/facilities and uses `currentOrg`, `hasRole`, React Query and existing status/error patterns.

**Proposed placement:** add a dedicated Plant Management route and sidebar entry for profile catalog/drafts/versions, then add an assignment panel or tab to the existing greenhouse/zone management view. Reuse `DashboardLayout`, `useAuth`, `apiClient.request`, React Query, form/status components and tenant-keyed query keys. Treat server authorization as authoritative; hiding controls by `hasRole` is only UI affordance.

## 10. Missing capabilities and implementation gaps

1. No plant taxonomy/profile/version/stage/parameter schema, migrations, or seed catalog.
2. No validation contract for species-specific values, ranges, units, stage ordering, duration, or parameter inheritance.
3. No draft/validate/activate lifecycle, immutable version or audit history.
4. No zone assignment, assignment history, crop-cycle status, or consistency constraint between assignment and zone/greenhouse/organization.
5. No rule engine implementations, decision manager, priority policy, conflict explanation, or safety override semantics.
6. No decision record tying input telemetry, profile version, stage, engine version, selected action and rejection/priority reasoning together.
7. No stale/missing/invalid configuration policy or profile version compatibility behavior.
8. No plant API, client types, screens, role-aware UI, or tests.
9. No edge config handler, local copy, version acknowledgment, rollback, signature/checksum, or offline expiry/fallback behavior.
10. Existing control commands have command-level audit and transport availability checks, but they do not prevent physically unsafe/manual actions using plant constraints.
11. `AI_AGENT` exists as an enum value but has no dedicated machine identity/scope model evident here.
12. Docs are mixed: root README and app READMEs are starter/template-oriented; `docs/phase5.md`, `phase6.md`, telemetry and infrastructure docs describe implemented foundation, while the master prompt describes intended broader architecture and must not be used as a claim of current implementation.

## 11. Proposed API endpoints — not implemented

Use NestJS controller/service/DTO conventions, `class-validator`, Swagger decorators, global `/api`, explicit `@Roles`, and membership checks.

| Method and route | Purpose | Suggested access |
|---|---|---|
| `GET /api/plant-profiles?organizationId=...` | List tenant-visible profiles and status | Member read |
| `POST /api/plant-profiles` | Create organization-owned draft | OWNER, ADMIN |
| `GET /api/plant-profiles/:id` | Read profile and versions | Member of owning org |
| `PATCH /api/plant-profiles/:id` | Edit draft metadata only | OWNER, ADMIN |
| `POST /api/plant-profiles/:id/versions` | Create draft version with stages/parameters | OWNER, ADMIN |
| `GET /api/plant-profiles/:id/versions/:versionId` | Read immutable version and validation result | Member |
| `POST /api/plant-profiles/:id/versions/:versionId/validate` | Run deterministic schema/range/cross-field validation | OWNER, ADMIN |
| `POST /api/plant-profiles/:id/versions/:versionId/activate` | Activate validated version, optionally for zone | OWNER, ADMIN; require idempotency and audit |
| `GET /api/zones/:id/plant-assignment` | Get current assignment and effective stage | Member |
| `PUT /api/zones/:id/plant-assignment` | Assign approved version/stage, closing previous assignment transactionally | OWNER, ADMIN, OPERATOR (approved versions only) |
| `GET /api/zones/:id/plant-assignment/history` | Read assignment/activation timeline | Member |

Prefer explicit nested route DTOs and server-resolved org ownership. Return validation as structured field errors plus warnings, not only a boolean. Avoid an endpoint that directly mutates runtime actuator state as a side effect of profile activation.

## 12. Proposed configuration activation and versioning flow

1. Author creates/edits a **draft**; draft edits never affect live decisions.
2. Server validates tenant ownership, schema version, required parameter definitions, units, bounds, stage key/order uniqueness, cross-parameter constraints, actuator capability compatibility (where applicable), and safe limits.
3. Validation result is persisted with validator/schema version and timestamp. Invalid drafts cannot activate.
4. On successful validation, freeze a **versioned immutable snapshot**, calculate a stable content checksum, and retain the prior versions.
5. An OWNER/ADMIN activates a specific validated version for a zone or assignment. In one database transaction, close the prior effective assignment, create the new assignment/activation event, record actor/reason, and ensure the version/stage belongs to that same profile version.
6. The backend resolves the effective version/stage and records the version/checksum on every eventual rule decision. Keep an explicit rollback action that creates a new activation event pointing to an older immutable version; do not rewrite history.
7. If edge distribution becomes required, publish after commit through a durable outbox, include version/checksum/schema version, require device acknowledgment, and do not mark edge activation complete until it validates and acknowledges. Define expiry and safe fallback before rollout.

## 13. Safety, offline, and backward-compatibility risks

- **Active control risk:** plant parameter activation can affect irrigation or other physical outputs. No rule interlocks currently exist. Never silently translate profile activation into actuator commands.
- **Offline operation:** Redis realtime TTL and device stale detection are not offline agronomic control. Do not assume an edge controller can safely use fresh plant settings; it currently has no configuration copy.
- **Stale/missing profile:** define fail-safe behavior separately for monitoring, recommendations, and actuation. Do not infer default thresholds from sample telemetry or species names.
- **Version compatibility:** database snapshots, API DTO schema, evaluator version and eventual firmware capabilities need explicit compatibility IDs. Preserve old version readability.
- **Tenant isolation:** enforce org ownership through server-side joins and guards; verify direct IDs cannot cross organizations. Also validate zone/greenhouse consistency in device assignment paths.
- **Race conditions:** stage changes and activation need transaction/optimistic concurrency/idempotency so concurrent edits cannot activate an unvalidated draft.
- **MQTT contract:** parser supports `config` but operational subscriptions/firmware do not. Avoid assuming contract support or changing payloads without compatibility testing.
- **Existing broker posture:** `docker-compose.yml` uses development anonymous/no-match allow settings and leaves ACL mount commented. Any configuration/control distribution requires production-grade broker auth/ACL and TLS verification.
- **Migration/rollback:** current database is shared by auth, telemetry and actuation. New migrations must be additive first, avoid destructive defaults, support old rows and deployed API versions, and be rehearsed against a disposable environment before any real migration.
- **History retention:** profile/version/activation and decision audit need retention/export policy distinct from telemetry retention and command records.

## 14. Test plan and acceptance criteria for Phase 10.1–10.6

No tests were run for this audit. Existing API test conventions are Vitest (`apps/api/vitest.config.ts`, `vitest.config.e2e.ts`), colocated `*.spec.ts` unit tests and `apps/api/test/*.e2e-spec.ts` integration tests. E2E tests instantiate the real app and exercise PostgreSQL/Redis/MQTT; they are stateful and must not be run without an explicitly prepared test environment. No web test script or web test files were found in the listed tree.

| Phase | Suggested scope and acceptance criteria |
|---|---|
| 10.1 Domain and schema | Agree species/profile/version/stage/parameter/assignment semantics; additive Prisma migration and constraints; generate client in development; prove version/stage/profile consistency and tenant ownership. Unit-test constraints and migration compatibility in disposable DB. |
| 10.2 API and RBAC | CRUD drafts/versions, validation endpoint, activation and zone assignment/history; test all roles, cross-tenant IDs, DTO rejection, no direct draft activation, idempotency and transaction rollback. |
| 10.3 Validation/catalog | Canonical definitions, units, ranges and stage rules; test boundary values, missing/unknown parameters, cross-field conflicts, supported species/profile extensions, deterministic validation report and immutable snapshot checksum. |
| 10.4 Dashboard | Profile list/editor/version diff/validation result and zone assignment UI; test loading/error/empty states, role visibility and successful API flows; server still denies unauthorized calls. |
| 10.5 Rule engines/Decision Manager | Implement one engine at a time behind pure input/output interfaces; fixture tests for each of seven engines, priorities/conflict arbitration, missing/stale/invalid readings/config, safety override and decision trace/version attribution. Do not enable actuator side effects until interlock tests pass. |
| 10.6 Edge/offline integration | Only if required: schema-versioned config transport, signature/checksum, ack/retry/idempotency, offline expiry/fallback, firmware compatibility matrix, old payload regression and hardware-in-loop tests. No silent activation on partial delivery. |

Cross-phase acceptance: audit events identify actor/profile version/zone and timestamps; every decision identifies exact config and rule-engine versions; invalid or stale config never produces an untraceable automatic action; all migrations and contract changes have rollback/compatibility instructions.

## 15. Recommended implementation sequence

1. Confirm product decisions: platform catalog versus organization-owned profiles, parameter inheritance, stage progression semantics, allowed units/ranges, activation scope, offline requirements and role matrix.
2. Deliver Phase 10.1 as a domain/schema specification and threat/safety review, then implement only the additive profile/version/stage/parameter/assignment/audit schema and migration.
3. Add tenant-safe DTO/service/API and authorization tests before UI.
4. Add deterministic profile validation and immutable version activation/history; use the dashboard for management and zone assignment.
5. Define normalized engine input/output and decision trace contracts. Implement/test each named engine and centralized conflict resolution; preserve direct manual command flow but add explicit safety interlocks before automatic outputs.
6. Add config distribution/edge evaluation only after requirement proof and safe offline semantics. Keep current MQTT topic/payload compatibility until separate review and integration tests are approved.

## 16. Explicit files inspected

### Repository/configuration and docs

- `README.md`
- `Master Prompt Antigravity IDE #U2014 Greenhouse IoT Platform.md` (treated as intended design, not source evidence)
- `apps/api/package.json`, `apps/api/package-lock.json`, `apps/web/package.json`, `apps/web/package-lock.json`
- `apps/api/README.md`, `apps/web/README.md`
- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` (migration directory names and schema-relevant SQL via search)
- `docs/telemetry.md`, `docs/development.md`, `docs/authentication.md`, `docs/phase5.md`, `docs/phase6.md`, `docs/infrastructure.md`
- `docker-compose.yml`, `infrastructure/emqx/emqx.conf`, `infrastructure/emqx/acl.conf`

### API

- `apps/api/src/app.module.ts`, `apps/api/src/main.ts`
- `apps/api/src/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `authorization.service.ts`, `auth.types.ts`
- `apps/api/src/auth/guards/jwt-auth.guard.ts`, `roles.guard.ts`, `resource-access.guard.ts`
- `apps/api/src/auth/decorators/roles.decorator.ts`, `public.decorator.ts`, `current-user.decorator.ts`
- `apps/api/src/organizations/organizations.controller.ts`, `organizations.service.ts`, DTOs
- `apps/api/src/greenhouses/greenhouses.controller.ts`, `greenhouses.service.ts`, DTOs
- `apps/api/src/zones/zones.controller.ts`, `zones.service.ts`, DTOs
- `apps/api/src/devices/devices.controller.ts`, `devices.service.ts`, DTOs
- `apps/api/src/sensors/sensors.controller.ts`, `sensors.service.ts`, DTOs
- `apps/api/src/actuators/actuators.controller.ts`, `actuators.service.ts`, `control-commands.service.ts`, DTOs
- `apps/api/src/mqtt/mqtt.constants.ts`, `mqtt.types.ts`, `mqtt.service.ts`
- `apps/api/src/telemetry/telemetry-processor.service.ts`, `telemetry-realtime.service.ts`, `telemetry-persistence.service.ts`, `telemetry.gateway.ts`, `interfaces/telemetry.interfaces.ts`, `dto/telemetry.dto.ts`
- Test inventory: `apps/api/src/**/*.spec.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/test/auth.e2e-spec.ts`, Vitest configs

### Web and firmware

- `apps/web/src/app/` route inventory; specifically `greenhouses/page.tsx` and `settings/page.tsx`
- `apps/web/src/lib/api-client.ts`, `apps/web/src/types/index.ts`, `apps/web/src/components/layout/sidebar.tsx`
- `firmware/esp32_s3_greenhouse/esp32_s3_greenhouse.ino`

### Areas not verified

- No live database contents or deployed schema were inspected.
- No running MQTT broker, Redis, API service, or production configuration was queried.
- No compiled firmware or hardware behavior was tested.
- No generated Prisma client behavior or browser runtime was verified.
- Repository state was already dirty before the audit, with staged/unstaged changes and untracked migration/source files across API, web and firmware. The audit left those files untouched; findings describe the inspected working tree, not a clean commit snapshot.
- The parent workspace `package-lock.json` was listed in the initial workspace inventory, but package-manager intent for that parent-level file was not verified.

## 17. Exact inspection commands and results

Commands below were inspection-only. Shell commands were run from `D:\greenhouse-iot-phase6-auth\greenhouse-iot`, unless a project-relative working directory is stated.

| Command | Result |
|---|---|
| `rg --files` | Listed project tree; confirmed API, web, firmware, docs, infrastructure and tests; no Plant module/route files in tree |
| `Get-Content apps/api/prisma/schema.prisma` | Read current Prisma enums/models/relations |
| `Get-ChildItem apps/api/prisma/migrations -Directory \| Select-Object -ExpandProperty Name` | Listed four migrations, through auth and control-command audit |
| `Get-Content apps/api/package.json; Get-Content apps/web/package.json` | Read per-app npm scripts/dependencies; no root project manifest was present in the project tree |
| `git status --short` | Found pre-existing staged/unstaged/untracked changes; no files were modified by audit inspection |
| `rg -n -i "plant\|crop\|species\|growth.?stage\|profile.?version\|decision.?manager\|rule.?engine\|fertigation\|irrigation\|emergency\|safety\|climate\|fan\|valve\|priority\|actuator" apps docs firmware infrastructure` | Broad search was noisy due generic actuator/fan terms; did not establish plant engines. Follow-up targeted search below returned no app-source matches |
| `rg -n "Rule Engine\|Decision Manager\|irrigation\|fertigation\|emergency\|safety\|priority\|conflict\|decision" apps/api/src firmware/esp32_s3_greenhouse/esp32_s3_greenhouse.ino docs --glob '!*.spec.ts'` | Exit 1, no matches in source and `docs/`; root design prompt was not in this command |
| `rg -n -i "rule.?engine\|decision manager\|irrigation\|fertigation\|emergency\|species\|growth stage\|plant profile\|/plants" apps/api/src firmware/esp32_s3_greenhouse/esp32_s3_greenhouse.ino docs 'Master Prompt Antigravity IDE #U2014 Greenhouse IoT Platform.md' --glob '!*.spec.ts'` | Matches the root master prompt's planned plant/rule sections; application source/firmware matches were absent. Prompt contents were treated as design intent only |
| `rg -n "TOPIC_\|greenhouse/\|subscribe\\(\|publish\\(\|command\|response\|offline\|retain\|lastWill\|LWT" apps/api/src/mqtt apps/api/src/telemetry firmware/esp32_s3_greenhouse/esp32_s3_greenhouse.ino infrastructure/emqx` | Located topic, publish/subscribe, command response and offline/LWT code |
| `rg -n "^model \|^enum \|@@(unique\|index\|map)\|greenhouseId\|zoneId\|organizationId\|role\|metadata\|Json\|ControlCommand" apps/api/prisma/schema.prisma` | Located all current models, relations, JSON fields, constraints and indexes |
| `rg -n "CREATE TABLE\|CREATE TYPE\|CREATE INDEX\|REFERENCES\|UNIQUE" apps/api/prisma/migrations` | Inspected SQL migration object/constraint inventory |
| `Get-Content apps/api/src/auth/authorization.service.ts; Get-Content apps/api/src/auth/guards/roles.guard.ts; Get-Content apps/api/src/auth/guards/resource-access.guard.ts; Get-Content apps/api/src/auth/decorators/roles.decorator.ts; Get-Content apps/api/src/auth/auth.types.ts; Get-Content apps/api/src/auth/auth.module.ts; Get-Content apps/api/src/main.ts` | Verified roles, global guard registration, tenant membership/resource resolution, global prefix and validation configuration |
| `Get-Content apps/api/src/greenhouses/greenhouses.controller.ts; Get-Content apps/api/src/zones/zones.controller.ts; Get-Content apps/api/src/devices/devices.controller.ts; Get-Content apps/api/src/sensors/sensors.controller.ts; Get-Content apps/api/src/actuators/actuators.controller.ts; Get-Content apps/api/src/organizations/organizations.controller.ts` | Verified existing endpoint and `@Roles` allow-list patterns |
| `Get-Content apps/api/src/mqtt/mqtt.constants.ts; Get-Content apps/api/src/mqtt/mqtt.types.ts; Get-Content apps/api/src/telemetry/interfaces/telemetry.interfaces.ts; Get-Content apps/api/src/telemetry/dto/telemetry.dto.ts` | Verified parser message types, default MQTT subscriptions and payload contracts |
| `Get-Content apps/api/src/telemetry/telemetry-processor.service.ts; Get-Content apps/api/src/telemetry/telemetry-realtime.service.ts; Get-Content apps/api/src/actuators/control-commands.service.ts` | Verified processing/validation, sequence handling, realtime thresholds and manual command lifecycle |
| `rg -n "validateTelemetryPayload\|validateStatusPayload\|Number.isFinite\|status === 'offline'\|STALE\|OFFLINE" apps/api/src/telemetry/telemetry-processor.service.ts apps/api/src/telemetry/telemetry-realtime.service.ts` | Verified value validation and stale/offline logic; no finite/range validation found in telemetry validator |
| `rg -n "@Controller\|@Get\|@Post\|@Patch\|@Delete\|@Roles\|UseGuards" apps/api/src/{organizations,greenhouses,zones,devices,sensors,actuators,telemetry,auth}` | Initial brace expansion is not supported by the PowerShell invocation and produced a parser error; controller files were then read directly |
| `rg -n "test\|lint\|build\|workspace\|workspaces" package-lock.json apps/api/package.json apps/web/package.json` | Parent-relative package-lock path was absent from project root; app scripts were read directly from their package manifests |
| `rg --files apps/api/src \| rg '\\.spec\\.ts$'; rg --files apps/api/test` | Listed API unit and e2e test files; no web test file appeared in project inventory |
| `Get-Content apps/web/src/lib/api-client.ts; Get-Content apps/web/src/components/layout/sidebar.tsx; Get-Content apps/web/src/app/settings/page.tsx; Get-Content apps/web/src/app/greenhouses/page.tsx` | Verified web API-client methods, navigation, current-organization patterns, and reusable greenhouse/zone UI |
| `Get-Content infrastructure/emqx/acl.conf; Get-Content docker-compose.yml` | Verified ACL sample and development broker settings; ACL mount is commented in Compose |
| `rg -n "TOPIC_\|subscribe\\(\|publish\\(\|LWT\|offline\|command\|response\|config\|telemetry" firmware/esp32_s3_greenhouse/esp32_s3_greenhouse.ino` | Located firmware topics, heartbeat, LWT, command and response handlers; no config handler found |
| `Get-Content docs/telemetry.md; Get-Content docs/development.md; Get-Content docs/authentication.md; Get-Content docs/phase5.md; Get-Content docs/phase6.md` | Read architecture and intended/current behavior documentation |

One exploratory command referenced the wrong working-directory-relative path for a web file and returned “path not found”; the corrected command was run from `apps/web` and inspection completed. No implementation or verification command in this audit changed application state.
