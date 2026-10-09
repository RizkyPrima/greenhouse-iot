# Infrastructure Documentation — Greenhouse IoT Platform

## Phase 1: Infrastructure

### Services Overview

| Container           | Image                  | Ports (host→container)     | Role                     |
|---------------------|------------------------|----------------------------|--------------------------|
| `greenhouse-emqx`   | `emqx/emqx:5.8.6`      | 1883, 8083, 8084, 8883, 18083 | MQTT Broker           |
| `greenhouse-postgres` | `postgres:16-alpine`  | 5432→5432                  | Primary Database         |
| `greenhouse-redis`  | `redis:7.4-alpine`     | 6379→6379                  | Cache & Realtime State   |

---

## EMQX

### Ports

| Port  | Protocol       | Description                        |
|-------|----------------|------------------------------------|
| 1883  | MQTT TCP       | Standard MQTT (plain)              |
| 8083  | MQTT WebSocket | MQTT over WebSocket (path: `/mqtt`)|
| 8084  | MQTT WSS       | MQTT over WebSocket (TLS)          |
| 8883  | MQTT TLS       | MQTT over TLS                      |
| 18083 | HTTP           | EMQX Dashboard (Web UI)            |

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

> [!NOTE]
> EMQX is configured with `EMQX_AUTHORIZATION__NO_MATCH: allow` for Phase 1 development convenience.
> In Phase 5, switch to proper authentication (password-based or JWT) and strict ACL rules.

> [!NOTE]
> TLS/MQTTS (port 8883) and WSS (port 8084) require certificates.
> These will be configured in the production deployment phase.
