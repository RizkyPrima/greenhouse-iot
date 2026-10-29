/**
 * ==============================================================================================
 * Smart Greenhouse IoT Platform - Edge Controller Firmware
 * Hardware Target: ESP32-S3-N16R8 (16MB Flash, 8MB Octal PSRAM)
 * Protocol: MQTT (EMQX) via WiFi
 * Topic Schema: greenhouse/{greenhouseId}/{deviceId}/{messageType}
 * ==============================================================================================
 * 
 * Required Libraries (Install via Arduino Library Manager):
 * 1. PubSubClient by Nick O'Leary (v2.8+)
 * 2. ArduinoJson by Benoit Blanchon (v6.x or v7.x)
 * 3. DHT sensor library by Adafruit (Optional if using physical DHT22/DHT11)
 * 4. Adafruit Unified Sensor (Optional dependency for DHT)
 *
 * Board Settings in Arduino IDE:
 * - Board: "ESP32S3 Dev Module"
 * - Flash Size: "16MB (128Mb)"
 * - Partition Scheme: "16M Flash (3MB APP/9.9MB FATFS)" or "Huge APP (3MB No OTA)"
 * - PSRAM: "OPI PSRAM" (for N16R8 octal PSRAM)
 * - Upload Speed: 921600
 * - USB CDC On Boot: Enabled (if using direct USB-C port)
 * ==============================================================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>

// ==============================================================================================
// 1. NETWORK & BROKER CONFIGURATION
// ==============================================================================================
// Sesuaikan dengan SSID & Password WiFi Anda (2.4GHz)
const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";

// IP Komputer / Server yang menjalankan EMQX broker
// IP LAN komputer yang menjalankan EMQX; gunakan DHCP reservation agar alamat tidak berubah.
const char* MQTT_BROKER   = "192.168.1.170";
const int   MQTT_PORT     = 1883;
const char* MQTT_USER     = "";  // Kosongkan jika broker tanpa auth
const char* MQTT_PASS     = "";  // Kosongkan jika broker tanpa auth

// ==============================================================================================
// 2. GREENHOUSE IDENTIFIER & TOPIC SCHEMA
// ==============================================================================================
// Sesuai dengan data di platform web (bisa kode "GH-MAIN-01" atau ID cuid)
const char* GREENHOUSE_ID = "GH-MAIN-01";
const char* DEVICE_ID     = "ESP32-S3-01";
const char* FIRMWARE_VER  = "1.1.0-esp32s3";

// MQTT Topics (dibuat secara dinamis di setup)
char TOPIC_TELEMETRY[80];
char TOPIC_STATUS[80];
char TOPIC_COMMAND[80];
char TOPIC_CONFIG[80];
char TOPIC_RESPONSE[80];

// ==============================================================================================
// 3. HARDWARE GPIO PIN CONFIGURATION
// ==============================================================================================
#define USE_PHYSICAL_SENSORS false  // Set true jika sensor fisik sudah terpasang, false untuk simulasi

// Pin Sensor (sesuaikan dengan wiring Anda pada ESP32-S3)
#define PIN_DHT           4   // GPIO 4 untuk DHT22 / DHT11
#define PIN_SOIL_ANALOG   5   // GPIO 5 (ADC1_CH4) untuk Capacitive Soil Moisture Sensor
#define PIN_LDR_ANALOG    6   // GPIO 6 (ADC1_CH5) untuk LDR Light Sensor

// Pin Aktuator Relay (Active HIGH atau LOW tergantung modul relay Anda)
#define PIN_RELAY_PUMP    1   // GPIO 1 - Pompa Air Irigasi
#define PIN_RELAY_FAN     2   // GPIO 2 - Kipas Ventilasi Exhaust
#define PIN_RELAY_LIGHT   42  // GPIO 42 - Lampu Grow Light Tambahan
#define PIN_STATUS_LED    48  // GPIO 48 - Onboard LED (RGB/Status pada ESP32-S3)

#define RELAY_ACTIVE_LEVEL HIGH // Ubah ke LOW jika modul relay active-low

// ==============================================================================================
// 4. OBJECTS & GLOBALS
// ==============================================================================================
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Preferences configPreferences;

const char* MONITORING_SENSOR_CODES[] = {
  "temperature", "humidity", "soil_moisture", "light_intensity"
};
const uint8_t MAX_MONITORING_SENSOR_CODES = 4;
char configuredSensorCodes[MAX_MONITORING_SENSOR_CODES][24];
uint8_t configuredSensorCount = 4;
uint32_t plantConfigurationVersion = 0;
char plantConfigurationId[40] = "";

unsigned long lastTelemetryMillis = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 5000; // Kirim telemetri setiap 5 detik

unsigned long lastStatusMillis = 0;
const unsigned long STATUS_INTERVAL_MS = 10000;  // Kirim heartbeat status setiap 10 detik (Rule Phase 8: <= 15s ONLINE)

uint32_t telemetrySequence = 1;

// NTP Server untuk Sinkronisasi Timestamp Akurat
const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.google.com";
const long  GMT_OFFSET_SEC = 7 * 3600; // WIB (UTC+7)
const int   DAYLIGHT_OFFSET_SEC = 0;

// State Aktuator Lokal
bool statePump  = false;
bool stateFan   = false;
bool stateLight = false;

// ==============================================================================================
// 5. HELPER FUNCTIONS
// ==============================================================================================

// Dapatkan waktu UNIX Epoch dalam milidetik
uint64_t getEpochTimeMs() {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  if (tv.tv_sec < 1000000) {
    // Fallback jika NTP belum tersinkronisasi
    return (uint64_t)millis();
  }
  return ((uint64_t)tv.tv_sec * 1000ULL) + ((uint64_t)tv.tv_usec / 1000ULL);
}

// Inisialisasi Topic MQTT
void initTopics() {
  snprintf(TOPIC_TELEMETRY, sizeof(TOPIC_TELEMETRY), "greenhouse/%s/%s/telemetry", GREENHOUSE_ID, DEVICE_ID);
  snprintf(TOPIC_STATUS,    sizeof(TOPIC_STATUS),    "greenhouse/%s/%s/status",    GREENHOUSE_ID, DEVICE_ID);
  snprintf(TOPIC_COMMAND,   sizeof(TOPIC_COMMAND),   "greenhouse/%s/%s/command",   GREENHOUSE_ID, DEVICE_ID);
  snprintf(TOPIC_CONFIG,    sizeof(TOPIC_CONFIG),    "greenhouse/%s/%s/config",    GREENHOUSE_ID, DEVICE_ID);
  snprintf(TOPIC_RESPONSE,  sizeof(TOPIC_RESPONSE), "greenhouse/%s/%s/response", GREENHOUSE_ID, DEVICE_ID);
}

bool isSupportedMonitoringSensor(const char* code) {
  for (uint8_t i = 0; i < MAX_MONITORING_SENSOR_CODES; i++) {
    if (strcmp(code, MONITORING_SENSOR_CODES[i]) == 0) return true;
  }
  return false;
}

bool isConfiguredMonitoringSensor(const char* code) {
  for (uint8_t i = 0; i < configuredSensorCount; i++) {
    if (strcmp(code, configuredSensorCodes[i]) == 0) return true;
  }
  return false;
}

void loadPlantConfiguration() {
  strcpy(configuredSensorCodes[0], "temperature");
  strcpy(configuredSensorCodes[1], "humidity");
  strcpy(configuredSensorCodes[2], "soil_moisture");
  strcpy(configuredSensorCodes[3], "light_intensity");
  configuredSensorCount = 4;

  if (!configPreferences.begin("plant-config", true)) return;
  String stored = configPreferences.getString("snapshot", "");
  configPreferences.end();
  if (stored.length() == 0) return;

  StaticJsonDocument<512> snapshot;
  if (deserializeJson(snapshot, stored)) return;
  JsonArrayConst codes = snapshot["sensorCodes"].as<JsonArrayConst>();
  const char* storedId = snapshot["configurationId"] | "";
  const uint32_t storedVersion = snapshot["version"] | 0;
  if (codes.isNull() || codes.size() == 0 || codes.size() > MAX_MONITORING_SENSOR_CODES
      || strlen(storedId) == 0 || strlen(storedId) >= sizeof(plantConfigurationId)
      || storedVersion == 0) return;

  char restoredCodes[MAX_MONITORING_SENSOR_CODES][24];
  for (uint8_t i = 0; i < codes.size(); i++) {
    const char* code = codes[i] | "";
    if (!isSupportedMonitoringSensor(code)) return;
    for (uint8_t j = 0; j < i; j++) {
      if (strcmp(code, restoredCodes[j]) == 0) return;
    }
    strlcpy(restoredCodes[i], code, sizeof(restoredCodes[i]));
  }
  configuredSensorCount = codes.size();
  for (uint8_t i = 0; i < configuredSensorCount; i++) {
    strlcpy(configuredSensorCodes[i], restoredCodes[i], sizeof(configuredSensorCodes[i]));
  }
  plantConfigurationVersion = storedVersion;
  strlcpy(plantConfigurationId, storedId, sizeof(plantConfigurationId));
}

// ==============================================================================================
// 6. SENSOR READINGS (REAL OR SIMULATED)
// ==============================================================================================
float readTemperature() {
  if (USE_PHYSICAL_SENSORS) {
    // Baca sensor fisik (misal: dht.readTemperature())
    return 27.5; 
  } else {
    // Nilai realistis dengan sedikit variasi acak (24.0°C - 31.0°C)
    float base = 26.5;
    float jitter = ((float)(random(-15, 16)) / 10.0);
    return base + jitter;
  }
}

float readHumidity() {
  if (USE_PHYSICAL_SENSORS) {
    return 70.0;
  } else {
    // Nilai realistis kelembaban udara (60% - 85%)
    float base = 72.0;
    float jitter = ((float)(random(-25, 26)) / 10.0);
    return base + jitter;
  }
}

float readSoilMoisture() {
  if (USE_PHYSICAL_SENSORS) {
    int raw = analogRead(PIN_SOIL_ANALOG);
    // Konversi ADC 12-bit (0-4095) ke persentase kelembaban tanah 0-100%
    float pct = map(raw, 4095, 1500, 0, 100);
    return constrain(pct, 0.0, 100.0);
  } else {
    // Simulasi kelembaban tanah (60% - 75%)
    float base = 65.0;
    float jitter = ((float)(random(-20, 21)) / 10.0);
    return base + jitter;
  }
}

float readLightIntensity() {
  if (USE_PHYSICAL_SENSORS) {
    int raw = analogRead(PIN_LDR_ANALOG);
    return (float)raw * 0.5; // Estimasi Lux
  } else {
    // Simulasi intensitas cahaya (400 - 950 Lux)
    float base = 750.0;
    float jitter = (float)(random(-80, 81));
    return base + jitter;
  }
}

// ==============================================================================================
// 7. ACTUATOR CONTROL & COMMAND HANDLER
// ==============================================================================================
void setRelay(int pin, bool state) {
  digitalWrite(pin, state ? RELAY_ACTIVE_LEVEL : !RELAY_ACTIVE_LEVEL);
}

void publishCommandResponse(const char* commandId, const char* actuator, const char* status, bool activeState, const char* error = "") {
  StaticJsonDocument<320> resp;
  resp["deviceId"] = DEVICE_ID;
  resp["commandId"] = commandId;
  resp["actuator"] = actuator;
  resp["status"] = status;
  resp["activeState"] = activeState;
  resp["error"] = error;
  resp["ts"] = getEpochTimeMs();
  char responsePayload[320];
  serializeJson(resp, responsePayload);
  if (!mqttClient.publish(TOPIC_RESPONSE, responsePayload)) {
    Serial.printf("[MQTT RESP ERROR] Failed to publish response to %s\n", TOPIC_RESPONSE);
  }
}

const char* parameterKeyForSensor(const char* sensorCode) {
  if (strcmp(sensorCode, "temperature") == 0) return "air_temperature";
  if (strcmp(sensorCode, "humidity") == 0) return "relative_humidity";
  if (strcmp(sensorCode, "soil_moisture") == 0) return "soil_moisture";
  if (strcmp(sensorCode, "light_intensity") == 0) return "light_intensity";
  return "";
}

void publishPlantConfigurationAck(const char* configurationId, uint32_t version, const char* status, const char* error = "") {
  StaticJsonDocument<384> response;
  response["type"] = "plant_config";
  response["deviceId"] = DEVICE_ID;
  response["configurationId"] = configurationId && strlen(configurationId) < 40 ? configurationId : "";
  response["version"] = version;
  response["status"] = status;
  if (strlen(error) > 0) response["error"] = error;
  response["ts"] = getEpochTimeMs();
  char payload[384];
  serializeJson(response, payload);
  if (!mqttClient.publish(TOPIC_RESPONSE, payload)) {
    Serial.printf("[PLANT CONFIG ACK ERROR] Failed to publish status=%s\n", status);
  }
}

bool hasOnlyPlantConfigurationFields(JsonObjectConst object) {
  const char* const allowed[] = {
    "type", "schema", "configurationId", "version", "mode",
    "catalogVersionId", "parameterKeys", "sensorCodes"
  };
  for (JsonPairConst pair : object) {
    bool found = false;
    for (uint8_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); i++) {
      if (strcmp(pair.key().c_str(), allowed[i]) == 0) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

void rejectPlantConfiguration(const char* configurationId, uint32_t version, const char* reason) {
  publishPlantConfigurationAck(configurationId, version, "REJECTED", reason);
  Serial.printf("[PLANT CONFIG REJECTED] %s\n", reason);
}

void handlePlantConfigurationPayload(const byte* payload, unsigned int length) {
  if (length >= 1024) {
    rejectPlantConfiguration("", 0, "payload_too_large");
    return;
  }
  char jsonBuffer[1024];
  memcpy(jsonBuffer, payload, length);
  jsonBuffer[length] = '\0';

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, jsonBuffer) || !doc.is<JsonObject>()) {
    rejectPlantConfiguration("", 0, "invalid_json");
    return;
  }
  JsonObjectConst object = doc.as<JsonObjectConst>();
  const char* configurationId = object["configurationId"] | "";
  const char* schema = object["schema"] | "";
  const char* mode = object["mode"] | "";
  const char* type = object["type"] | "";
  const char* catalogVersionId = object["catalogVersionId"] | "";
  const uint32_t version = object["version"] | 0;
  JsonArrayConst parameterKeys = object["parameterKeys"].as<JsonArrayConst>();
  JsonArrayConst sensorCodes = object["sensorCodes"].as<JsonArrayConst>();

  if (!hasOnlyPlantConfigurationFields(object)
      || strcmp(type, "plant_config") != 0
      || strcmp(schema, "plant-monitoring/v1") != 0
      || strcmp(mode, "monitoring_only") != 0
      || strlen(configurationId) == 0 || strlen(configurationId) >= 40
      || strlen(catalogVersionId) == 0 || strlen(catalogVersionId) > 100
      || version == 0
      || sensorCodes.isNull() || parameterKeys.isNull()
      || sensorCodes.size() == 0 || sensorCodes.size() > MAX_MONITORING_SENSOR_CODES
      || parameterKeys.size() != sensorCodes.size()) {
    rejectPlantConfiguration(configurationId, version, "invalid_monitoring_configuration");
    return;
  }

  char nextSensorCodes[MAX_MONITORING_SENSOR_CODES][24];
  for (uint8_t i = 0; i < sensorCodes.size(); i++) {
    const char* sensorCode = sensorCodes[i] | "";
    const char* parameterKey = parameterKeys[i] | "";
    if (!isSupportedMonitoringSensor(sensorCode)
        || strcmp(parameterKey, parameterKeyForSensor(sensorCode)) != 0) {
      rejectPlantConfiguration(configurationId, version, "unsupported_or_mismatched_sensor");
      return;
    }
    for (uint8_t j = 0; j < i; j++) {
      if (strcmp(sensorCode, nextSensorCodes[j]) == 0) {
        rejectPlantConfiguration(configurationId, version, "duplicate_sensor_code");
        return;
      }
    }
    strlcpy(nextSensorCodes[i], sensorCode, sizeof(nextSensorCodes[i]));
  }

  if (version == plantConfigurationVersion && strcmp(configurationId, plantConfigurationId) == 0) {
    publishPlantConfigurationAck(configurationId, version, "RECEIVED");
    publishPlantConfigurationAck(configurationId, version, "APPLIED");
    return;
  }
  if (version <= plantConfigurationVersion) {
    rejectPlantConfiguration(configurationId, version, "configuration_version_not_newer");
    return;
  }

  publishPlantConfigurationAck(configurationId, version, "RECEIVED");
  StaticJsonDocument<512> snapshot;
  snapshot["configurationId"] = configurationId;
  snapshot["version"] = version;
  JsonArray savedCodes = snapshot.createNestedArray("sensorCodes");
  for (uint8_t i = 0; i < sensorCodes.size(); i++) savedCodes.add(nextSensorCodes[i]);
  char snapshotPayload[512];
  serializeJson(snapshot, snapshotPayload);

  if (!configPreferences.begin("plant-config", false)) {
    rejectPlantConfiguration(configurationId, version, "persistent_storage_unavailable");
    return;
  }
  const size_t savedBytes = configPreferences.putString("snapshot", snapshotPayload);
  configPreferences.end();
  if (savedBytes != strlen(snapshotPayload)) {
    rejectPlantConfiguration(configurationId, version, "persistent_storage_write_failed");
    return;
  }

  configuredSensorCount = sensorCodes.size();
  for (uint8_t i = 0; i < configuredSensorCount; i++) {
    strlcpy(configuredSensorCodes[i], nextSensorCodes[i], sizeof(configuredSensorCodes[i]));
  }
  plantConfigurationVersion = version;
  strlcpy(plantConfigurationId, configurationId, sizeof(plantConfigurationId));
  publishPlantConfigurationAck(configurationId, version, "APPLIED");
  Serial.printf("[PLANT CONFIG APPLIED] version=%lu sensors=%u\n", (unsigned long)version, configuredSensorCount);
}

void handleCommandPayload(char* topic, byte* payload, unsigned int length) {
  Serial.printf("\n[MQTT CMD] Received on topic: %s\n", topic);
  if (strcmp(topic, TOPIC_COMMAND) != 0) {
    Serial.println("[MQTT CMD ERROR] Command topic mismatch");
    return;
  }

  // Buat buffer string dari payload
  char jsonBuffer[512];
  if (length >= sizeof(jsonBuffer)) {
    Serial.println("[MQTT CMD ERROR] Payload too large for buffer");
    return;
  }
  memcpy(jsonBuffer, payload, length);
  jsonBuffer[length] = '\0';
  Serial.printf("[MQTT CMD] Payload: %s\n", jsonBuffer);

  // Parse JSON
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, jsonBuffer);
  if (err) {
    Serial.printf("[MQTT CMD ERROR] JSON deserialize failed: %s\n", err.c_str());
    return;
  }

  const char* commandId = doc["commandId"] | "";
  const char* actuator = doc["actuator"] | "";
  const char* command = doc["command"] | "";
  String actStr(actuator);
  actStr.toLowerCase();
  String commandStr(command);
  commandStr.toUpperCase();
  const bool targetState = commandStr == "ON";

  if (strlen(commandId) == 0 || strlen(commandId) > 64 || strlen(actuator) == 0
      || (commandStr != "ON" && commandStr != "OFF")) {
    publishCommandResponse(commandId, actuator, "invalid_command", false, "commandId, actuator, and ON/OFF command are required");
    return;
  }

  bool* state = nullptr;
  int pin = -1;
  if (actStr == "pump") { state = &statePump; pin = PIN_RELAY_PUMP; }
  else if (actStr == "fan") { state = &stateFan; pin = PIN_RELAY_FAN; }
  else if (actStr == "light") { state = &stateLight; pin = PIN_RELAY_LIGHT; }

  if (!state) {
    publishCommandResponse(commandId, actuator, "unknown_actuator", false, "unsupported actuator target");
    return;
  }

  *state = targetState;
  setRelay(pin, *state);
  Serial.printf("[ACTUATOR] %s set to: %s\n", actuator, *state ? "ON" : "OFF");
  publishCommandResponse(commandId, actuator, "success", *state);
}

void handleMqttPayload(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, TOPIC_CONFIG) == 0) {
    handlePlantConfigurationPayload(payload, length);
  } else if (strcmp(topic, TOPIC_COMMAND) == 0) {
    handleCommandPayload(topic, payload, length);
  }
}

// ==============================================================================================
// 8. MQTT PUBLISH ROUTINES
// ==============================================================================================

// Kirim Heartbeat & System Status
void publishStatus(const char* statusStr) {
  StaticJsonDocument<384> doc;
  doc["status"]    = statusStr;
  doc["ip"]        = WiFi.localIP().toString();
  doc["rssi"]      = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime"]    = (uint32_t)(millis() / 1000);
  doc["firmware"]  = FIRMWARE_VER;
  doc["ts"]        = getEpochTimeMs();
  JsonObject capabilities = doc.createNestedObject("capabilities");
  capabilities["plantConfiguration"] = "plant-monitoring/v1";
  capabilities["sensorDataMode"] = USE_PHYSICAL_SENSORS ? "PHYSICAL" : "SIMULATED";
  JsonArray sensorCodes = capabilities.createNestedArray("sensorCodes");
  for (uint8_t i = 0; i < MAX_MONITORING_SENSOR_CODES; i++) {
    sensorCodes.add(MONITORING_SENSOR_CODES[i]);
  }

  char buffer[384];
  size_t n = serializeJson(doc, buffer);
  
  // Retain = false untuk status periodik
  bool ok = mqttClient.publish(TOPIC_STATUS, buffer, false);
  if (ok) {
    Serial.printf("[STATUS] Published -> %s firmware=%s plantConfiguration=plant-monitoring/v1 (Heap: %u B, RSSI: %d dBm)\n",
                  statusStr, FIRMWARE_VER, ESP.getFreeHeap(), WiFi.RSSI());
  } else {
    Serial.println("[STATUS ERROR] Failed to publish status");
  }
}

// Kirim Paket Telemetri Sensor Realtime
void publishTelemetry() {
  float temp = readTemperature();
  float hum  = readHumidity();
  float soil = readSoilMoisture();
  float lux  = readLightIntensity();

  // Struktur JSON sesuai validator backend (telemetry-processor.service.ts)
  StaticJsonDocument<512> doc;
  doc["seq"] = telemetrySequence++;
  doc["ts"]  = getEpochTimeMs();

  JsonArray sensors = doc.createNestedArray("sensors");

  if (isConfiguredMonitoringSensor("temperature")) {
    JsonObject reading = sensors.createNestedObject();
    reading["code"] = "temperature";
    reading["value"] = round(temp * 10.0) / 10.0;
    reading["unit"] = "°C";
  }
  if (isConfiguredMonitoringSensor("humidity")) {
    JsonObject reading = sensors.createNestedObject();
    reading["code"] = "humidity";
    reading["value"] = round(hum * 10.0) / 10.0;
    reading["unit"] = "%";
  }
  if (isConfiguredMonitoringSensor("soil_moisture")) {
    JsonObject reading = sensors.createNestedObject();
    reading["code"] = "soil_moisture";
    reading["value"] = round(soil * 10.0) / 10.0;
    reading["unit"] = "%";
  }
  if (isConfiguredMonitoringSensor("light_intensity")) {
    JsonObject reading = sensors.createNestedObject();
    reading["code"] = "light_intensity";
    reading["value"] = round(lux * 10.0) / 10.0;
    reading["unit"] = "lux";
  }

  char buffer[512];
  size_t len = serializeJson(doc, buffer);

  bool published = mqttClient.publish(TOPIC_TELEMETRY, buffer);
  if (published) {
    Serial.printf("[TELEMETRY #%u] Temp: %.1f°C | Hum: %.1f%% | Soil: %.1f%% | Light: %.0f lux\n",
                  telemetrySequence - 1, temp, hum, soil, lux);
  } else {
    Serial.println("[TELEMETRY ERROR] Publish failed (check broker connection)");
  }
}

// ==============================================================================================
// 9. CONNECTION MANAGEMENT (WIFI & MQTT)
// ==============================================================================================
void setupWiFi() {
  Serial.println();
  Serial.printf("[WIFI] Connecting to SSID: %s\n", WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("[WIFI] Connected successfully!");
    Serial.printf("[WIFI] IP Address:  %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WIFI] Gateway:     %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("[WIFI] Signal RSSI: %d dBm\n", WiFi.RSSI());

    // Konfigurasi sinkronisasi waktu NTP
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2);
    Serial.println("[NTP] Time synchronization requested");
  } else {
    Serial.println("\n[WIFI ERROR] Failed to connect to WiFi! Check SSID/Password.");
  }
}

void connectMQTT() {
  while (!mqttClient.connected()) {
    if (WiFi.status() != WL_CONNECTED) {
      setupWiFi();
      return;
    }

    Serial.printf("[MQTT] Connecting to broker at %s:%d as '%s'...\n", MQTT_BROKER, MQTT_PORT, DEVICE_ID);

    // Last Will & Testament (LWT): Jika koneksi terputus tiba-tiba, broker otomatis publikasi offline
    const char* lwtPayload = "{\"status\":\"offline\"}";
    
    bool connected = false;
    if (strlen(MQTT_USER) > 0) {
      connected = mqttClient.connect(DEVICE_ID, MQTT_USER, MQTT_PASS, TOPIC_STATUS, 1, true, lwtPayload);
    } else {
      connected = mqttClient.connect(DEVICE_ID, TOPIC_STATUS, 1, true, lwtPayload);
    }

    if (connected) {
      Serial.println("[MQTT] Connected to EMQX Broker!");

      // 1. Publikasikan status online pertama kali
      publishStatus("online");

      // 2. Subscribe ke topic command untuk kontrol aktuator
      mqttClient.subscribe(TOPIC_COMMAND);
      Serial.printf("[MQTT] Subscribed to commands: %s\n", TOPIC_COMMAND);
      mqttClient.subscribe(TOPIC_CONFIG);
      Serial.printf("[MQTT] Subscribed to monitoring configuration: %s\n", TOPIC_CONFIG);
      
    } else {
      Serial.printf("[MQTT ERROR] Connection failed, rc=%d. Retrying in 4s...\n", mqttClient.state());
      delay(4000);
    }
  }
}

// ==============================================================================================
// 10. SETUP & MAIN LOOP
// ==============================================================================================
void setup() {
  Serial.begin(115200);
  delay(1500); // Waktu stabilisasi Serial pada USB CDC

  Serial.println("\n=======================================================");
  Serial.println("  ESP32-S3-N16R8 SMART GREENHOUSE CONTROLLER FIRMWARE  ");
  Serial.println("=======================================================");

  // Cek PSRAM & Flash Memory
  Serial.printf("[HW] Flash Size:  %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("[HW] Free Heap:   %u KB\n", ESP.getFreeHeap() / 1024);
  if (psramFound()) {
    Serial.printf("[HW] PSRAM Found: %u KB Free PSRAM: %u KB\n", 
                  ESP.getPsramSize() / 1024, ESP.getFreePsram() / 1024);
  } else {
    Serial.println("[HW] PSRAM: Not Enabled (check board settings in IDE)");
  }

  // Setup GPIO Relay Aktuator
  pinMode(PIN_RELAY_PUMP, OUTPUT);
  pinMode(PIN_RELAY_FAN, OUTPUT);
  pinMode(PIN_RELAY_LIGHT, OUTPUT);
  setRelay(PIN_RELAY_PUMP, false);
  setRelay(PIN_RELAY_FAN, false);
  setRelay(PIN_RELAY_LIGHT, false);

  // Inisialisasi Topic
  initTopics();
  loadPlantConfiguration();
  Serial.printf("[CONFIG] Greenhouse ID: %s\n", GREENHOUSE_ID);
  Serial.printf("[CONFIG] Device ID:     %s\n", DEVICE_ID);

  // Konfigurasi PubSubClient Buffer
  // PENTING: Buffer dinaikkan ke 1024 agar payload JSON tidak terpotong!
  mqttClient.setBufferSize(1024);
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(handleMqttPayload);
  mqttClient.setKeepAlive(30);

  // Sambungkan ke WiFi
  setupWiFi();
}

void loop() {
  // 1. Pastikan WiFi selalu terhubung
  if (WiFi.status() != WL_CONNECTED) {
    setupWiFi();
    return;
  }

  // 2. Pastikan MQTT selalu terhubung
  if (!mqttClient.connected()) {
    connectMQTT();
  }
  
  // 3. Proses background event loop MQTT (terima command dll)
  mqttClient.loop();

  unsigned long currentMillis = millis();

  // 4. Kirim Paket Telemetri Berkala (tiap 5 detik)
  if (currentMillis - lastTelemetryMillis >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMillis = currentMillis;
    publishTelemetry();
  }

  // 5. Kirim Heartbeat Status Berkala (tiap 30 detik)
  if (currentMillis - lastStatusMillis >= STATUS_INTERVAL_MS) {
    lastStatusMillis = currentMillis;
    publishStatus("online");
  }
}
