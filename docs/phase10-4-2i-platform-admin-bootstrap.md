# Phase 10.4.2I — First Platform Admin Bootstrap

The application Research Registry and grant/revoke features are separate from provisioning the first `RESEARCH_SOURCE_GRANT_ADMIN` operator. Current Phase 10 acceptance material describes Phase 10.4 as dashboard work and does not list first-admin bootstrap as a required acceptance criterion. The repository still marks Phase 10 in progress; no claim is made here that all Phase 10 acceptance criteria are complete. Research Registry and grant/revoke code, guards, transactional audit, and tests exist; PostgreSQL integration tests remain unrun until a disposable target passes preflight and change-lock review.

## Deployment status: first grant administrator

**Deployment-blocked.** No trusted bootstrap approval signer/issuer is configured in this project. The CLI fails closed before constructing a Prisma client. `JWT_SECRET` and ordinary application access tokens are explicitly not accepted as approval evidence. Do not attempt to provision the first admin with the current command. No bootstrap has been performed by this work.

The grant operation is designed to create only `RESEARCH_SOURCE_GRANT_ADMIN`; it does not create users or grant catalog/source permissions. If a trusted signer is later approved and implemented, grant and `PlantConfigAuditEvent` must remain in one serializable transaction under the advisory lock, and the verified operator must be recorded as grant issuer/audit actor. Existing audit `details` supports a non-sensitive change reference; no schema or migration change is currently proposed.

## Keputusan identitas yang masih diperlukan

Sebelum provisioning dapat diaktifkan, pilih dan operasikan signer approval tepercaya yang tidak mengekspos private signing key ke operator CLI. Token harus khusus bootstrap dan memuat issuer, audience, permission/scope, `sub` terikat ke `User.id`, expiry/issued-at singkat, change reference, dan target yang disetujui. CLI harus memverifikasi klaim dengan public key yang dikelola deployment, memeriksa operator aktif, dan menolak self-grant. Ordinary access JWT dan `JWT_SECRET` tidak boleh diterima. Tidak ada OIDC/SSO atau migration yang disetujui dalam perubahan ini.

## Change approval and target verification

1. Obtain the normal security/change approval and record the approver, change/ticket ID, intended environment, database name, PostgreSQL server address and port, database role, target user ID, and reason. Use a non-secret record reference in the format `CHG-2026-1234`, `APPROVAL-2481`, `RFC-...`, or another accepted prefix; it must be 6–64 characters. The reference is recorded in audit details. Do not put credentials, tokens, email addresses, or free-form rationale in this field; keep rationale and approver identity in the change system.
2. Treat `--environment` as an operator label only. It is not derived from PostgreSQL and does not prove the environment. Before execution, use the approved infrastructure inventory and the change record as independent sources to map the intended environment to the exact database name, database role, endpoint/server address and port, and secret-manager entry. Verify that the secret-manager entry selected for this change maps to that approved target. Then make a read-only identity query through the selected connection and record `current_database()`, `inet_server_addr()`, `inet_server_port()`, and `current_user`. The bootstrap checks the database name, server-reported address and port, and role before opening its write transaction, but it cannot validate the truth of the environment label or approval record.
3. Verify the target user's ID and active status through an approved read-only account lookup. Review the existing grant and audit state. If any active `RESEARCH_SOURCE_GRANT_ADMIN` grant exists, stop; this is a first-admin bootstrap, not a reassignment or recovery tool.
4. Do not run the bootstrap while deployment status is blocked. If a signer design is approved and implemented later, the issuance process must bind the authenticated operator, approval/change reference, and exact target to a short-lived dedicated token. Its transport and verification procedure must be separately reviewed; never place a token or private key in command arguments, shell history, logs, or audit metadata.

## Execution

The CLI intentionally stops with `Trusted bootstrap signer is unavailable; platform admin bootstrap is deployment-blocked` before constructing `PrismaClient`. Do not provide `JWT_SECRET` or `BOOTSTRAP_OPERATOR_ACCESS_TOKEN` as a workaround. Disposable DB preflight, migration inventory, and the operational change lock are separate requirements and remain outstanding.

## Post-change verification and recovery

Using read-only queries, confirm exactly one active grant for `RESEARCH_SOURCE_GRANT_ADMIN`, that its recipient is the approved user, and that a `RESEARCH_SOURCE_GRANT_ADMIN_BOOTSTRAPPED` event exists for its grant ID with the verified operator as actor, expected recipient, permission, environment label, and `changeReference`. Save the audit reference in the change record. If execution reports a failure, verify whether the transaction rolled back and inspect database/audit state before deciding next steps.

If bootstrap has already happened, the script deliberately refuses to run, including when the active grant belongs to another user. Do not edit rows or revoke/regrant to make it run. For a lost, inactive, or incorrect first administrator, use the existing guarded grant-management process under an authorized `RESEARCH_SOURCE_GRANT_ADMIN` operator and record that as a separately approved recovery change. If no authorized operator exists, stop and obtain a separately reviewed recovery design; this script does not bypass the one-time check.

The script's lock coordinates callers using this bootstrap implementation. Database administrators or unrelated direct SQL writers can bypass the advisory lock; keep database write access controlled during the change window. Database identity checks compare the actual database name, server-reported address and port, and database role against operator-supplied approved values, but they do not validate the truth of the approval record itself.

## PostgreSQL integration tests

Unit tests use mocks only; they are not evidence of PostgreSQL concurrency or rollback behavior. The real-database suite is separate and must be run only through `apps/api/scripts/run-bootstrap-platform-admin.integration.ps1`, after a human has verified the disposable target and an enforceable change lock. The runner checks the dedicated loopback PostgreSQL container, health, restart policy `no`, tmpfs-only storage, isolated network, database/role/version, and exact successful migration inventory matching all local migration directories before exposing its URL to Vitest. It rejects duplicate, unknown, missing, failed, incomplete, or rolled-back migration records. The test config and suite do not load `.env`, do not apply migrations, and refuse any other URL/database/role/server address. They use distinct disposable operator/recipient fixtures and create one uniquely named trigger/function to force a real audit insert failure; fixtures and the trigger/function are removed in `finally`/`afterAll`. These tests exercise transaction behavior only, not a trusted signer; the CLI stays deployment-blocked. If preflight or migration checks fail, stop and prepare/verify the disposable test target separately; never substitute an application or production database.

### Preparing the disposable database schema

If a new, verified disposable database needs its Prisma schema, an operator may use `apps/api/scripts/prepare-bootstrap-test-db.ps1` only after approval of a test-database change record. It accepts the exact container ID, network ID, container server address, fixed database and role, change reference, reviewed local migration manifest hash, and matching confirmation as explicit arguments. It requires a running, healthy container with restart policy `no`, no persistent mounts, and the expected tmpfs. It does not read `.env` or use an inherited `DATABASE_URL` as its target. It constructs a URL from the dedicated test container's credential in process memory and suppresses command output that could disclose credentials. It does not run seeds, reset data, tests, or bootstrap.

The confirmation phrase explicitly authorizes **all pending migrations in the local Prisma migrations directory**. The seven named integration-test migrations are only a minimum required set; they do not limit what `prisma migrate deploy` applies. The local manifest hash covers `schema.prisma`, `migration_lock.toml`, and every local `migration.sql`. Review the complete local migration directory and the SQL impact of every migration that could be pending before approving. The script rejects any recorded database migration absent from the local directory and, after deploy, requires every local migration to have exactly one successful, non-rolled-back record; therefore any extra local migration is included in the approval and must also be applied and verified.

Before preparation, inspect the database read-only. Check whether `public."_prisma_migrations"` exists and inspect its rows if present. When the table is absent, do **not** infer the database is empty. The script inventories non-system schemas, relations, all non-system types, routines, operators, collations, conversions, operator classes/families, extensions, event triggers, foreign servers, publications, and subscriptions. It fails closed if the catalog query cannot complete or finds any such objects. This is still not a proof against every PostgreSQL object or external dependency: the operator must separately inspect database/role ownership and grants, extensions or shared objects outside the returned inventory, and any known prior use. If a catalog check is unavailable, ambiguous, or returns an unreviewed object, stop; use a separately approved fresh disposable database. The preparer refuses databases where Prisma metadata already exists, so it is intended only for a fresh target.

The change approval must explicitly record and confirm each item before the preparer is invoked:

- The exact container ID, network ID, server address, fixed database and role, change reference, and reviewed migration manifest hash.
- The database is disposable and recreatable, and contains no data that must be retained; record the evidence/source for that determination.
- Every migration in the local directory that could be pending was reviewed, including SQL impact, and the approval explicitly authorizes applying all of them.
- The required operational change lock is active and its evidence is recorded. Record the lock/change ID, designated operator, start time, paused automation and other Docker operators, controls preventing container/network/port replacement, controls preventing other database writers, and the time/owner responsible for releasing the lock after post-check.

The script cannot verify these approval assertions or prove the operational lock is active. Missing evidence or inability to enforce any lock control means stop; do not treat the script's identity checks as a substitute.

From `apps/api`, obtain IDs and the current container IP using reviewed read-only Docker inspection. Independently compare them with the approved disposable-target record. Compute the migration manifest hash using the local files (the command below only reads files):

```powershell
$prismaRoot = (Resolve-Path .\prisma).Path
$files = @((Join-Path $prismaRoot 'schema.prisma'), (Join-Path $prismaRoot 'migrations\migration_lock.toml')) + @(
  Get-ChildItem (Join-Path $prismaRoot 'migrations') -Directory | Sort-Object Name | ForEach-Object { Join-Path $_.FullName 'migration.sql' }
)
$entries = @($files | ForEach-Object {
  $relative = [IO.Path]::GetRelativePath($prismaRoot, $_).Replace('\', '/')
  '{0}:{1}' -f $relative, (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
} | Sort-Object)
$payload = [Text.Encoding]::UTF8.GetBytes([string]::Join("`n", [string[]]$entries))
$sha = [Security.Cryptography.SHA256]::Create()
try { [BitConverter]::ToString($sha.ComputeHash($payload)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
```

Use placeholders until all values and the manifest hash are independently reviewed. Bind the exact confirmation text to the inspected target, change reference, and hash. Do not copy any password or URL into the command:

```powershell
.\scripts\prepare-bootstrap-test-db.ps1 `
  -ExpectedContainerId '<verified-64-hex-container-id>' `
  -ExpectedNetworkId '<verified-64-hex-network-id>' `
  -ExpectedServerAddress '<verified-container-ip>' `
  -DatabaseName 'plants_phase1023_test' `
  -DatabaseRole 'plants_test' `
  -ChangeReference 'CHG-YYYY-NNNN' `
  -ExpectedMigrationManifestSha256 '<reviewed-64-hex-manifest-sha256>' `
  -ConfirmTarget 'APPLY-ALL-PENDING-LOCAL-MIGRATIONS:<verified-64-hex-container-id>:<verified-64-hex-network-id>:<verified-container-ip>:plants_phase1023_test:plants_test:CHG-YYYY-NNNN:<reviewed-64-hex-manifest-sha256>'
```

The example values are placeholders and must be replaced with approved values. Approval must state that `prisma migrate deploy` will apply every pending migration in the reviewed local directory and must identify the database target, change reference, and manifest hash. It must also confirm the database is disposable/recreatable with no data to retain, that all local migrations were reviewed, and that the change lock is active. Review the sanitized target output against that record before proceeding. The post-check fails for failed, incomplete, rolled-back, duplicate, missing, or unexpected migration rows; it compares recorded names with the entire reviewed local directory, not only the seven required names.

A failed, interrupted, or terminated `prisma migrate deploy` can leave partial schema/data changes and a failed or incomplete Prisma migration record. The preparer does not roll back database changes. Do not retry, run reset, drop objects, delete migration records, or perform cleanup automatically. Stop and preserve the target; an operator must perform read-only inspection of `_prisma_migrations` and the actual schema, compare them with the migration SQL, and obtain a separately approved recovery decision before any further mutation. Interruption is not a safe rollback mechanism.

**TOCTOU limitation and operational lock:** the TCP identity probe and Prisma CLI migration use separate connections. The database reached by Prisma can differ from the one checked by the probe if the container, network, or loopback port is replaced between those steps. A later identity recheck alone would not eliminate that race; the script cannot atomically pin Docker's container/network identity to Prisma's connection. Before approving or starting this change, establish an exclusive operational change lock: pause automation and other operators that can replace, stop, reconnect, or reconfigure the test container/network or rebind the loopback port; restrict Docker write access to the designated operator; and prevent other database writers. Record the lock/change ID, responsible operator, active time window, paused actors/automation, enforcement evidence for Docker and database access, and who confirms release after post-check. Maintain it from initial inspection through successful post-check. If the lock is not active, cannot be enforced, or lacks recorded evidence, do not run this preparer. A future technical alternative would run migration from a worker bound to the verified container identity/network or otherwise pin the database backend. These checks and the lock reduce operational risk but do not remove the architectural race.

After successful preparation, run the integration runner separately; it performs its own strict preflight. If any identity check or post-migration verification fails, stop and inspect the disposable target read-only; do not bypass or weaken the runner.
