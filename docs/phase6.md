# Phase 6 Manual Validation

Run from `apps/api` after PostgreSQL, Redis and EMQX are running.

## 1. Regenerate Prisma Client

Because Phase 6 adds `User`, `OrganizationMembership` and `RefreshSession`, regenerate the Prisma client:

```powershell
npx prisma generate
npx prisma migrate status
```

If the Phase 6 migration is pending:

```powershell
npx prisma migrate deploy
```

Do not use `prisma migrate reset` for validation.

## 2. Build and lint

```powershell
npm run build
npm run lint
```

Expected:

```text
build: exit code 0
lint: 0 warnings and 0 errors
```

## 3. Start API

```powershell
npm run start:dev
```

Open Swagger:

`http://localhost:3001/api/docs`

## 4. Register

`POST /api/auth/register`

Example:

```json
{
  "email": "owner@example.com",
  "password": "StrongPassword123!",
  "name": "Greenhouse Owner"
}
```

Expected: `201` and no `passwordHash` in the response.

## 5. Login

`POST /api/auth/login`

Copy `data.accessToken` and `data.refreshToken`.

## 6. Authenticate Swagger

Click **Authorize** and enter:

```text
Bearer <accessToken>
```

Then call:

`GET /api/auth/me`

Expected: `200`.

## 7. Unauthorized check

Call:

`GET /api/organizations`

without a token.

Expected:

```text
401 Unauthorized
```

## 8. Create organization

With the owner token:

`POST /api/organizations`

The response must contain an `OWNER` membership for the current user.

## 9. Add a viewer

Register a second user, then as OWNER:

`POST /api/organizations/{organizationId}/members`

```json
{
  "email": "viewer@example.com",
  "role": "VIEWER"
}
```

## 10. Viewer access

Login as the viewer.

Expected:

- `GET /api/organizations/{organizationId}` → `200`
- `POST /api/greenhouses` → `403`

This verifies RBAC.

## 11. Cross-organization isolation

Create a second organization owned by another user.

Attempt to access it using the first user's token:

`GET /api/organizations/{otherOrganizationId}`

Expected:

```text
403 Forbidden
```

## 12. Refresh rotation

Call:

`POST /api/auth/refresh`

with the original refresh token.

Expected:

- new access token
- new refresh token
- old refresh token becomes invalid

## 13. Logout

Call:

`POST /api/auth/logout`

with the current refresh token.

Calling `/api/auth/refresh` again with that token must return `401`.

## 14. Health remains public

Call:

`GET /api/health`

without authentication.

Expected: `200` when all services are healthy, otherwise `503` with service status details.

## 15. Regression

Run:

```powershell
npm test
npm run test:e2e
npm run build
npm run lint
```

Phase 6 is complete only when authentication, authorization and the existing Phase 1–5 regression suite all pass.
