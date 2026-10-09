-- CreateTable
CREATE TABLE "telemetry_records" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceMqttId" TEXT NOT NULL,
    "greenhouseId" TEXT NOT NULL,
    "sequenceNumber" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "telemetry_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_values" (
    "id" TEXT NOT NULL,
    "telemetryRecordId" TEXT NOT NULL,
    "sensorId" TEXT,
    "sensorCode" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "stringValue" TEXT,
    "unit" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telemetry_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_status_logs" (
    "id" TEXT NOT NULL,
    "deviceMqttId" TEXT NOT NULL,
    "greenhouseId" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL,
    "ipAddress" TEXT,
    "rssi" INTEGER,
    "freeHeap" INTEGER,
    "uptime" INTEGER,
    "firmwareVersion" TEXT,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telemetry_records_deviceId_idx" ON "telemetry_records"("deviceId");

-- CreateIndex
CREATE INDEX "telemetry_records_greenhouseId_idx" ON "telemetry_records"("greenhouseId");

-- CreateIndex
CREATE INDEX "telemetry_records_receivedAt_idx" ON "telemetry_records"("receivedAt");

-- CreateIndex
CREATE INDEX "telemetry_values_telemetryRecordId_idx" ON "telemetry_values"("telemetryRecordId");

-- CreateIndex
CREATE INDEX "telemetry_values_sensorId_idx" ON "telemetry_values"("sensorId");

-- CreateIndex
CREATE INDEX "telemetry_values_timestamp_idx" ON "telemetry_values"("timestamp");

-- CreateIndex
CREATE INDEX "device_status_logs_deviceMqttId_idx" ON "device_status_logs"("deviceMqttId");

-- CreateIndex
CREATE INDEX "device_status_logs_greenhouseId_idx" ON "device_status_logs"("greenhouseId");

-- CreateIndex
CREATE INDEX "device_status_logs_receivedAt_idx" ON "device_status_logs"("receivedAt");

-- AddForeignKey
ALTER TABLE "telemetry_records" ADD CONSTRAINT "telemetry_records_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_values" ADD CONSTRAINT "telemetry_values_telemetryRecordId_fkey" FOREIGN KEY ("telemetryRecordId") REFERENCES "telemetry_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_values" ADD CONSTRAINT "telemetry_values_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "sensors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
