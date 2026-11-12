# Infrastructure Documentation — Greenhouse IoT Platform

## Phase 1: Infrastructure

### Services Overview

| Container           | Image                  | Ports (host→container)     | Role                     |
|---------------------|------------------------|----------------------------|--------------------------|
| `greenhouse-emqx`   | `emqx/emqx:5.8.6`      | development: loopback 1883/18083; production: configured MQTTS 8883 | MQTT Broker |
| `greenhouse-postgres` | `postgres:16-alpine`  | 5432→5432                  | Primary Database         |
| `greenhouse-redis`  | `redis:7.4-alpine`     | 6379→6379                  | Cache & Realtime State   |

---

## EMQX

### Development and production

The default `docker-compose.yml` is development-only: MQTT TCP and the dashboard
are bound to `127.0.0.1`. It requires authenticated MQTT clients and denies
unmatched topics. It is not reachable by physical devices over the LAN.

The broker-only production deployment uses the separate
`docker-compose.production.yml` (API, database, and cache are deployed
separately) and
`infrastructure/emqx/emqx.production.conf`. It exposes only MQTT over TLS (8883)
and uses mounted certificate files. Configure a hostname present in the broker
certificate and use `MQTT_PROTOCOL=mqtts` in the API. Never enable plaintext
MQTT/WSS or anonymous access in a production override.

Both configs use EMQX built-in password authentication and built-in database
authorization with `no_match = deny`. The backend client is provisioned at API
startup; each device receives exact topic rules only through the authenticated
device provisioning API. Management API keys and passwords must come from a
secret manager and must not be stored in tracked files.

The API starts only after it can create/update its own broker identity using
the EMQX Management API. Create the API key after the development broker is
running, then inject the API URL/key/secret and backend MQTT username/password
into the API runtime. Production must use HTTPS for this endpoint and MQTTS for
the broker connection.

### Device provisioning

1. Register the device under its greenhouse using the tenant-authorized device
   API. Unknown MQTT identities are rejected; telemetry ingestion does not
   create devices.
2. An OWNER or ADMIN member of that device's organization calls
   `POST /api/devices/{deviceDbId}/mqtt-credentials`. The route verifies the tenant
   membership, registered device, and active greenhouse.
3. The response contains a newly generated password once. It is not stored in
   PostgreSQL or logged. A repeat call rotates the password and ACL.
4. Put the returned `device:{deviceId}` username/password and the broker CA certificate in the
   device's local, ignored `firmware/esp32_s3_greenhouse/secrets.h`, copied from
   `secrets.example.h`, then build and deploy that firmware.
5. Deleting a device, changing its device ID, or moving it to another greenhouse
   removes its EMQX user/rules. Re-provision after changing identity.

Each device can publish only telemetry/status/event/alarm/response on its
registered greenhouse/device topic and subscribe only to command/config on
those same topic paths. The API backend has its own credential and broad
greenhouse access; do not reuse it on a device.

The EMQX API key used by NestJS must be able to manage built-in authentication
users and authorization rules. Treat it as highly privileged unless the
deployed EMQX edition supports a narrower role; restrict its network access and
store it in a secret manager. In production, set `EMQX_API_URL` to an HTTPS
endpoint whose certificate is trusted by Node.js.
When using a private CA, configure Node.js trust (for example
`NODE_EXTRA_CA_CERTS`) instead of disabling certificate validation.

### Ports

| Port  | Protocol       | Description                        |
|-------|----------------|------------------------------------|
| 1883  | MQTT TCP       | Development only; host loopback    |
| 8883  | MQTT TLS       | MQTT over TLS                      |
| 18083 | HTTP           | Development dashboard; host loopback |
| 18084 | HTTPS          | Production management API inside private network |

### Dashboard Access

- **URL:** http://localhost:18083
- **Username:** `admin`
- **Password:** see `.env` → `EMQX_DASHBOARD_DEFAULT_PASSWORD`

### EMQX REST API

- **Base URL:** http://localhost:18083/api/v5
- **Docs:** http://localhost:18083/api-docs

### Topic Convention (Phase 5)

```text
greenhouse/{greenhouse_id}/{device_id}/{message_type}
```

| Message Type | Direction          | Description              |
|--------------|--------------------|--------------------------|
| `telemetry`  | Device → Backend   | Sensor readings          |
| `status`     | Device → Backend   | Online/offline heartbeat |
| `event`      | Device → Backend   | Discrete events          |
| `alarm`      | Device → Backend   | Alarm notifications      |
| `command`    | Backend → Device   | Control commands         |
| `response`   | Device → Backend   | Command acknowledgement  |
| `config`     | Backend → Device   | Configuration push       |

### Health Check

```bash
# Via Docker
docker exec greenhouse-emqx emqx ping

# Via HTTP API
curl http://localhost:18083/api/v5/nodes \
  -u admin:<EMQX_DASHBOARD_DEFAULT_PASSWORD>
```

---

## PostgreSQL

### Connection Details

| Parameter | Value (from `.env`)   |
|-----------|-----------------------|
| Host      | `localhost` (host) / `postgres` (within Docker network) |
| Port      | `5432`                |
| Database  | `POSTGRES_DB`         |
| Username  | `POSTGRES_USER`       |
| Password  | `POSTGRES_PASSWORD`   |

### Connection String

```text
postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>
```

### Extensions Installed

| Extension  | Purpose                          |
|------------|----------------------------------|
| uuid-ossp  | UUID generation (`uuid_generate_v4()`) |
| pgcrypto   | Cryptographic functions          |

> Schema and tables will be created by **Prisma migrations** in Phase 2.

### Health Check

```bash
# Via Docker
docker exec greenhouse-postgres pg_isready -U greenhouse_user -d greenhouse_db

# Via psql
docker exec -it greenhouse-postgres psql -U greenhouse_user -d greenhouse_db -c "SELECT version();"
```

---

## Redis

### Connection Details

| Parameter | Value (from `.env`) |
|-----------|---------------------|
| Host      | `localhost` (host) / `redis` (within Docker network) |
| Port      | `6379`              |
| Password  | `REDIS_PASSWORD`    |

### Connection URL

```text
redis://:<REDIS_PASSWORD>@localhost:6379
```

### Configuration

| Setting           | Value          | Description                          |
|-------------------|----------------|--------------------------------------|
| Max Memory        | 256 MB         | Max memory limit                     |
| Eviction Policy   | `allkeys-lru`  | Evict least recently used keys       |
| Persistence       | AOF + RDB      | Append-only file + periodic snapshots|
| AOF fsync         | `everysec`     | Sync to disk every second            |

### Usage in Platform

| Purpose              | Description                              |
|----------------------|------------------------------------------|
| Device current state | Latest telemetry reading per device      |
| Device online status | ONLINE / STALE / OFFLINE per device      |
| Session cache        | JWT refresh token blacklist              |
| Rate limiting        | API rate limiter (Phase 2)               |
| WebSocket pub/sub    | Realtime state broadcast (Phase 5)       |

### Health Check

```bash
# Via Docker
docker exec greenhouse-redis redis-cli -a <REDIS_PASSWORD> ping

# Expected response: PONG
```

---

## Docker Network

All services communicate via the internal Docker network:

```text
Network: greenhouse-network (bridge)
```

| Container              | Internal Hostname | Port  |
|------------------------|-------------------|-------|
| `greenhouse-emqx`      | `emqx`            | 1883  |
| `greenhouse-postgres`  | `postgres`        | 5432  |
| `greenhouse-redis`     | `redis`           | 6379  |

> NestJS API (Phase 2) will connect to these services using internal hostnames.

---

## Docker Volumes

| Volume Name                | Container Path               | Purpose          |
|----------------------------|------------------------------|------------------|
| `greenhouse_emqx_data`     | `/opt/emqx/data`             | EMQX persistent data |
| `greenhouse_emqx_log`      | `/opt/emqx/log`              | EMQX logs        |
| `greenhouse_postgres_data` | `/var/lib/postgresql/data`   | PostgreSQL data  |
| `greenhouse_redis_data`    | `/data`                      | Redis persistence|

---

## Common Commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Stop and remove volumes (⚠️ destroys all data)
docker compose down -v

# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f emqx
docker compose logs -f postgres
docker compose logs -f redis

# Container health status
docker compose ps

# Restart a single service
docker compose restart emqx

# Open PostgreSQL shell
docker exec -it greenhouse-postgres psql -U greenhouse_user -d greenhouse_db

# Open Redis CLI
docker exec -it greenhouse-redis redis-cli -a <REDIS_PASSWORD>
```

---

## Security Notes

> [!IMPORTANT]
> The `.env` file contains all credentials. Never commit it to Git.

> [!IMPORTANT]
> The broker intentionally has no anonymous fallback. Startup fails when its
> dashboard password or node cookie is absent. Never expose the development
> broker port; use the TLS-only production Compose file for devices. Existing
> firmware configured for anonymous/plaintext MQTT will stop connecting until
> it is re-provisioned with per-device credentials and the broker CA.
