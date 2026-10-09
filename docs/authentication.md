# Phase 6 — Authentication & Authorization

## Overview

Phase 6 adds the identity and access-control foundation for the Greenhouse IoT Platform.

The backend uses:

- Argon2 password hashing
- JWT access tokens
- Rotating, revocable refresh sessions
- Organization memberships with RBAC
- Resource-level organization isolation
- NestJS global authentication/authorization guards

## Roles

| Role | Intended access |
|---|---|
| OWNER | Organization administration, greenhouse/device management, user/member management |
| ADMIN | Greenhouse, zone, device and configuration management |
| OPERATOR | Monitoring and permitted operational control |
| VIEWER | Read-only monitoring |
| AI_AGENT | Future scoped machine identity; no unrestricted actuator control |

AI_AGENT is intentionally not a bypass around normal backend authorization.

## Authentication endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Protected requests use:

```text
Authorization: Bearer <access-token>
```

## Token model

Access tokens are short-lived and contain only the user subject and token type.

Refresh tokens contain a server-side session ID. The database stores only a SHA-256 hash of the refresh token. Refresh rotates the session by revoking the old session before issuing a new pair.

## Resource authorization

Authorization is based on:

```text
User
  -> OrganizationMembership
      -> Organization
          -> Greenhouse
              -> Zone
              -> Device
                  -> Sensor / Actuator
```

A user cannot access another organization's resources simply by knowing an ID.

Collection endpoints are filtered by organization membership. Resource endpoints validate the resource's organization before returning or mutating data.

## Organization membership

The first authenticated user who creates an organization is automatically assigned `OWNER`.

Owner endpoints:

- `POST /api/organizations/:id/members`
- `GET /api/organizations/:id/members`
- `PATCH /api/organizations/:id/members/:membershipId`

The backend prevents removal of the final organization owner.

## Public endpoints

The health endpoint remains public:

- `GET /api/health`

Authentication endpoints required to establish or rotate credentials are also public.

## Environment

Required in development/production configuration:

```env
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<different-strong-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Never commit production secrets.

## Swagger

Open:

`http://localhost:3001/api/docs`

Use **Authorize** and provide:

```text
Bearer <access-token>
```

## Security notes

- Passwords are never stored as plaintext.
- Password hashes are never returned by API responses.
- Tokens are not written to application logs.
- Client-supplied roles are not trusted.
- Organization membership is checked server-side.
- AI_AGENT does not receive unrestricted control privileges.
- MQTT is not considered an authorization boundary; control operations must be authorized by the API/control layer.
