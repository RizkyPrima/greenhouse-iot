# Upload firmware with Arduino IDE

This sketch targets the ESP32-S3 N16R8 (16 MB flash, 8 MB OPI PSRAM).

## One-time setup

1. Install Arduino IDE 2.x.
2. In Boards Manager, install the **esp32 by Espressif Systems** board package.
3. In Library Manager, install **PubSubClient**, **ArduinoJson**, and **WiFiManager**. DHT and Adafruit Unified Sensor are optional unless physical DHT support is added.
4. Open `esp32_s3_greenhouse.ino` in this folder.
5. In **Tools → Board**, select **ESP32S3 Dev Module**. Set Flash Size to **16MB**, PSRAM to **OPI PSRAM**, USB CDC On Boot to **Enabled**, and upload speed to **921600**. Select the 16 MB partition scheme available for the installed ESP32 board package.
6. Connect the ESP32-S3 over USB and select its serial port in **Tools → Port**.

## Secure MQTT credentials

1. Register the device in the correct greenhouse, then have an OWNER or ADMIN
   provision it through `POST /api/devices/{deviceDbId}/mqtt-credentials`.
2. Copy `secrets.example.h` to `secrets.h` in this directory (the latter is
   gitignored). Set the broker hostname, returned `device:{deviceId}` username,
   one-time password, and the CA certificate that signed the broker's TLS
   certificate. Do not paste credentials into the tracked sketch.
3. Keep `GREENHOUSE_ID` and `DEVICE_ID` in the sketch equal to the registered
   greenhouse code and device ID used during provisioning.

The sketch uses MQTTS on port 8883 and refuses to compile without `secrets.h`.
Its MQTT topics and payload format are unchanged.

## Build and upload

Click **Verify** to compile, then **Upload** to flash the connected board. Open **Serial Monitor** at **115200 baud** to see startup logs. If upload cannot connect, hold **BOOT** while upload starts, release it when `Connecting...` appears, and press **RESET** after upload if needed.

On first boot, join the `Greenhouse-<DEVICE_ID>` setup access point. Its temporary password is printed in Serial Monitor. Use the captive portal to enter the 2.4 GHz Wi-Fi credentials. WiFiManager saves them in ESP32 storage for later boots.

The firmware uses ESP32 Preferences/NVS for Wi-Fi credentials and plant configuration; it does not use SPIFFS. Source edits do not update a controller already in service. After upload, reconnect the ESP to MQTT and wait for a fresh heartbeat advertising `plant-monitoring/v2` before sending device configuration.
