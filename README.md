# Greenhouse IoT Platform

Smart Greenhouse IoT & Intelligence Platform — Phase 1: Infrastructure

## Architecture

```text
ESP32-S3 Controller
        ↓
      MQTT
        ↓
      EMQX
        ↓
   Backend API (Phase 2)
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
│   │   └── acl.conf         # EMQX ACL rules (Phase 5)
│   └── postgres/
│       └── init/
│           └── 01_init.sql  # DB init (extensions)
│
├── apps/                    # (Phase 2+)
│   ├── api/                 # NestJS backend
│   ├── web/                 # Next.js frontend
│   └── ai/                  # Python FastAPI AI service
│
├── packages/                # (Phase 2+)
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

- [x] **Phase 1** — Infrastructure (EMQX, PostgreSQL, Redis)
- [ ] **Phase 2** — Backend Foundation (NestJS, Prisma)
- [ ] **Phase 3** — Authentication (JWT, RBAC)
- [ ] **Phase 4** — Greenhouse Management
- [ ] **Phase 5** — MQTT Integration
- [ ] **Phase 6** — Web Dashboard
- [ ] **Phase 7** — AI Analytics
