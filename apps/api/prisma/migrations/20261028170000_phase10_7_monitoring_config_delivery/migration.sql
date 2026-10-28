CREATE TYPE "DevicePlantConfigurationStatus" AS ENUM (
  'PENDING',
  'PUBLISHING',
  'SENT',
  'RECEIVED',
  'APPLIED',
  'REJECTED',
  'TIMEOUT',
  'FAILED'
);

CREATE TABLE "device_plant_configurations" (
  "id" TEXT NOT NULL,
  "configurationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "deviceMqttId" TEXT NOT NULL,
  "catalogVersionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "DevicePlantConfigurationStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "error" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "device_plant_configurations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_plant_configurations_version_check" CHECK ("version" > 0),
  CONSTRAINT "device_plant_configurations_configurationId_key" UNIQUE ("configurationId"),
  CONSTRAINT "device_plant_configurations_deviceId_version_key" UNIQUE ("deviceId", "version"),
  CONSTRAINT "device_plant_configurations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "device_plant_configurations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "device_plant_configurations_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "plant_catalog_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "device_plant_configurations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "device_plant_configurations_organizationId_createdAt_idx" ON "device_plant_configurations"("organizationId", "createdAt");
CREATE INDEX "device_plant_configurations_deviceId_status_createdAt_idx" ON "device_plant_configurations"("deviceId", "status", "createdAt");
