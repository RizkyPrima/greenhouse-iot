# Greenhouse IoT Platform

Smart Greenhouse IoT & Intelligence Platform — Phase 10: Plant Standardization (In Progress)

## Architecture

```text
ESP32-S3 Controller
        ↓
      MQTT
        ↓
      EMQX
        ↓
   Backend API
        ↓
 ┌──────┼─────────┐
 ↓      ↓         ↓
DB    Redis       AI
        ↓
   Web Dashboard
```

## Quick Start

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Edit .env with your passwords
# (never commit .env to Git)

# 3. Start all services
docker compose up -d

# 4. Check status
docker compose ps

# 5. View logs
docker compose logs -f
```

## Services

| Service    | Port  | Description              |
|------------|-------|--------------------------|
| EMQX MQTT  | 1883  | MQTT broker (plain)      |
| EMQX WS    | 8083  | MQTT over WebSocket      |
| EMQX WSS   | 8084  | MQTT over WebSocket/TLS  |
| EMQX MQTTS | 8883  | MQTT over TLS            |
| EMQX UI    | 18083 | EMQX Dashboard           |
| PostgreSQL | 5432  | Primary database         |
| Redis      | 6379  | Cache & realtime state   |

## Documentation

- [Infrastructure](docs/infrastructure.md) — ports, credentials, health checks
- [Architecture](docs/architecture.md) — system architecture (Phase 2+)

## Project Structure

```text
greenhouse-iot/
│
├── infrastructure/
│   ├── emqx/
│   │   ├── emqx.conf        # EMQX override config
│   │   └── acl.conf         # EMQX ACL rules
│   └── postgres/
│       └── init/
│           └── 01_init.sql  # DB init (extensions)
│
├── apps/
│   ├── api/                 # NestJS backend
│   ├── web/                 # Next.js frontend
│   └── ai/                  # Python FastAPI AI service
│
├── packages/
│   ├── types/
│   ├── config/
│   └── validation/
│
├── docs/
│   └── infrastructure.md
│
├── docker-compose.yml
├── .env.example
├── .env                     # (gitignored)
├── .gitignore
└── README.md
```

## Implementation Phases

- [x] **Phases 1–8** — Completed
- [ ] **Phase 9** — Skipped
- [ ] **Phase 10** — In progress: Plant Standardization
