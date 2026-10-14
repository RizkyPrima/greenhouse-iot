CREATE TYPE "CommandStatus" AS ENUM (
  'PENDING',
  'SENT',
  'ACKNOWLEDGED',
  'EXECUTED',
  'FAILED',
  'TIMEOUT'
);

CREATE TABLE "control_commands" (
  "id" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "actuatorId" TEXT,
  "userId" TEXT,
  "command" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "control_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "control_commands_commandId_key" ON "control_commands"("commandId");
CREATE INDEX "control_commands_deviceId_idx" ON "control_commands"("deviceId");
CREATE INDEX "control_commands_actuatorId_idx" ON "control_commands"("actuatorId");
CREATE INDEX "control_commands_userId_idx" ON "control_commands"("userId");
CREATE INDEX "control_commands_commandId_idx" ON "control_commands"("commandId");

ALTER TABLE "control_commands"
  ADD CONSTRAINT "control_commands_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "control_commands"
  ADD CONSTRAINT "control_commands_actuatorId_fkey"
  FOREIGN KEY ("actuatorId") REFERENCES "actuators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "control_commands"
  ADD CONSTRAINT "control_commands_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
