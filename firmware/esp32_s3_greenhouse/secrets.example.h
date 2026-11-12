#pragma once

#define GREENHOUSE_MQTT_BROKER "mqtt.example.org"
#define GREENHOUSE_MQTT_USERNAME "registered-device-id"
#define GREENHOUSE_MQTT_PASSWORD "replace-with-one-time-provisioned-password"
#define GREENHOUSE_MQTT_ROOT_CA R"PEM(-----BEGIN CERTIFICATE-----
REPLACE_WITH_THE_CA_CERTIFICATE_THAT_SIGNED_THE_BROKER_CERTIFICATE
-----END CERTIFICATE-----)PEM"
