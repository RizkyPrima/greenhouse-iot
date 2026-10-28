# Phase 10.1B — Zone operation idempotency

Migration `20261028110000_phase10_1b_zone_activation_idempotency` adds the append-only `zone_activation_requests` ledger. It is additive: it creates the operation enum, ledger table, scoped unique index, actor index, checks, and a trigger that rejects updates and deletes. Prisma schema fields, relations, enum, and indexes match those objects. The organization and actor foreign keys use `ON DELETE RESTRICT`, consistent with indefinite ledger retention; fixture teardown must not delete ledger rows or their referenced records.

## Deployment

The migration has not been applied by this change. Apply it only through the deployment's approved database change process after verifying the exact database target and reviewing every migration that may be pending. From `apps/api`, the Prisma command is:

```powershell
npx prisma migrate deploy --schema prisma/schema.prisma
```

`migrate deploy` applies **all** pending migrations in the local Prisma migration directory, not only this migration. Supply `DATABASE_URL` through the deployment secret manager/credential store, never in command arguments or logs. Do not use `migrate reset` or edit an applied migration. Verify the deployment's migration inventory after the command using its established read-only procedure.

For rollout, apply and verify the additive schema before deploying the API version that reads/writes this ledger. The API version requires the table and enum to exist; deploying it first would break activation/deactivation requests.

The `scripts/run-plants-e2e.ps1` runner is specifically for the isolated disposable PostgreSQL E2E target. It verifies the dedicated container, loopback port, tmpfs-only storage, network, database, and role before applying migrations and starting tests. It is not a production deployment runner. Do not substitute `.env` or `greenhouse_db` for that target.

## Transaction and replay contract

- The unique key is `(organizationId, operation, idempotencyKey)`; the initial actor is stored separately.
- The request hash covers the operation and canonical request payload. Reusing a key with another payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- Replay checks current organization and resource authorization before returning the immutable original response snapshot.
- The zone row lock serializes operations on one zone. Assignment state, audit event, and successful ledger response are written in the same transaction; a failed assignment or audit write rolls all three back.
- Concurrent identical requests converge through the zone lock and ledger unique constraint; only the winning transaction writes the assignment/audit, and the other returns the stored response.
- There is no automatic ledger purge. Retention/deletion requires a separately approved policy and schema change.

The HTTP integration suite is guarded by `scripts/run-plants-e2e.ps1`; its preflight must not be bypassed. This documentation does not claim the migration is applied or that database-backed concurrency/failure-injection checks have run.
