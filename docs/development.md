# Greenhouse IoT Platform — Development Guide

Panduan operasional dan development backend API serta infrastruktur lokal.

---

## 1. Arsitektur Komponen

```text
Next.js (Web Frontend - Phase Nanti)
          │
          │ HTTP / REST (/api)
          ▼
   NestJS Backend API (Port 3001)
     ├── Health Check (/api/health)
     ├── Swagger OpenAPI (/api/docs)
     ├── Structured Logging & X-Request-ID
     │
     ├──────────────► PostgreSQL 16 (Port 5432, Prisma ORM)
     │
     └──────────────► Redis 7.4 (Port 6379, ioredis)
```

---

## 2. Menjalankan Infrastruktur (Docker Desktop)

Pastikan Docker Desktop sudah aktif, lalu jalankan container dari root workspace:

```bash
# Jalankan container di background
docker compose up -d

# Periksa status container (harus healthy)
docker compose ps
```

Container yang berjalan:
| Container Name | Service | Port Host | Status Health Check |
| --- | --- | --- | --- |
| `greenhouse-emqx` | EMQX Broker | 1883, 8883, 8083, 8084, 18083 | healthy |
| `greenhouse-postgres` | PostgreSQL 16 | 5432 | healthy (`pg_isready`) |
| `greenhouse-redis` | Redis 7.4 | 6379 | healthy (`redis-cli ping`) |

---

## 3. Konfigurasi Environment Variable

### Root Environment (`.env`)
Digunakan oleh Docker Compose untuk konfigurasi container:
```env
COMPOSE_PROJECT_NAME=greenhouse
POSTGRES_DB=greenhouse_db
POSTGRES_USER=greenhouse_user
POSTGRES_PASSWORD=Greenhouse@Dev2026
REDIS_PASSWORD=Redis@Dev2026
```

### Backend API Environment (`apps/api/.env`)
Digunakan oleh NestJS saat berjalan di host:
```env
NODE_ENV=development
API_HOST=0.0.0.0
API_PORT=3001
CORS_ORIGIN=http://localhost:3000

# PostgreSQL Connection (Prisma)
DATABASE_URL=postgresql://greenhouse_user:Greenhouse@Dev2026@localhost:5432/greenhouse_db

# Redis Connection (ioredis)
REDIS_URL=redis://:Redis@Dev2026@localhost:6379
```

> **Catatan Validasi Startup**:
> NestJS memvalidasi environment variable saat startup menggunakan `class-validator`. Jika variabel wajib seperti `DATABASE_URL` tidak tersedia, aplikasi akan gagal startup secara eksplisit dengan pesan error yang jelas.

---

## 4. Menjalankan Backend API (NestJS)

Masuk ke folder `apps/api`:

```bash
cd apps/api
```

### Install Dependencies
```bash
npm install
```

### Generate Prisma Client
```bash
npx prisma generate
```

### Development Mode (Watch)
```bash
npm run start:dev
```

### Production Build & Run
```bash
npm run build
npm run start:prod
```

Output log startup yang diharapkan:
```text
[Nest] LOG [PrismaService] Connected to PostgreSQL database via Prisma
[Nest] LOG [RedisService] Connected to Redis
[Nest] LOG [Bootstrap] ======================================================
[Nest] LOG [Bootstrap] Greenhouse API is running on: http://0.0.0.0:3001/api
[Nest] LOG [Bootstrap] Health Check endpoint     : http://0.0.0.0:3001/api/health
[Nest] LOG [Bootstrap] Swagger Documentation     : http://0.0.0.0:3001/api/docs
[Nest] LOG [Bootstrap] CORS allowed origin       : http://localhost:3000
[Nest] LOG [Bootstrap] ======================================================
```

---

## 5. Endpoints & Dokumentasi API

### Swagger / OpenAPI
Akses dokumentasi interaktif di browser:
- **URL**: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)

### Health Check Endpoint
- **URL**: `GET http://localhost:3001/api/health`
- **Response Normal (HTTP 200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-01T05:50:32.482Z",
  "services": {
    "api": "up",
    "database": "up",
    "redis": "up"
  }
}
```
- **Response Degraded (HTTP 503 Service Unavailable)**:
```json
{
  "status": "degraded",
  "timestamp": "2026-10-01T05:50:32.482Z",
  "services": {
    "api": "up",
    "database": "down",
    "redis": "up"
  }
}
```

---

## 6. Request ID & Logging Middleware

Setiap request yang masuk melalui HTTP ditangani oleh:
1. **`RequestIdMiddleware`**:
   - Membaca header `X-Request-ID`. Jika client mengirimkannya, ID tersebut dipertahankan.
   - Jika client tidak mengirimkan, backend otomatis membuat UUIDv4 baru.
   - Response header selalu menyertakan `X-Request-ID`.
2. **`LoggingMiddleware`**:
   - Menghasilkan structured log dengan format:
     `[METHOD] /path status - durationMs - RequestId: uuid`
3. **`AllExceptionsFilter`**:
   - Menstandarkan format response error dengan statusCode, timestamp, path, requestId, dan pesan error.

---

## 7. Testing & Quality Assurance

Semua pengujian menggunakan **Vitest** dan **Supertest**:

### Menjalankan Unit Tests
```bash
npm run test
```
*Menguji validasi environment variables, health service status logic, dan redis service initialization.*

### Menjalankan E2E Tests (Live Docker PostgreSQL & Redis)
```bash
npm run test:e2e
```
*Menguji live `GET /api/health`, propagation `X-Request-ID`, live Prisma `$queryRaw` ke PostgreSQL, dan Redis `SET` / `GET` / `DEL` pada key `system:health:test`.*

### Linting & Formatting
```bash
npm run lint
npm run format
```
