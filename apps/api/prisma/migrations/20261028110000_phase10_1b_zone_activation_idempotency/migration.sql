-- Persist the original result of each organization-scoped zone activation operation.
-- Retain records indefinitely; no cleanup job or automatic purge is defined.
CREATE TYPE "ZoneActivationOperation" AS ENUM ('ACTIVATE', 'DEACTIVATE');

CREATE TABLE "zone_activation_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operation" "ZoneActivationOperation" NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zone_activation_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "zone_activation_requests_key_length_check"
      CHECK (char_length("idempotencyKey") BETWEEN 1 AND 200),
    CONSTRAINT "zone_activation_requests_hash_check"
      CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "zone_activation_requests_response_object_check"
      CHECK (jsonb_typeof("response") = 'object'),
    CONSTRAINT "zone_activation_requests_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "zone_activation_requests_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "zone_activation_requests_organizationId_operation_idempotencyKey_key"
  ON "zone_activation_requests"("organizationId", "operation", "idempotencyKey");
CREATE INDEX "zone_activation_requests_actorUserId_createdAt_idx"
  ON "zone_activation_requests"("actorUserId", "createdAt");

CREATE FUNCTION zone_activation_requests_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Zone activation idempotency records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zone_activation_requests_append_only"
  BEFORE UPDATE OR DELETE ON "zone_activation_requests"
  FOR EACH ROW EXECUTE FUNCTION zone_activation_requests_append_only();
