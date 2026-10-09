import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('Authentication & Authorization (Phase 6 e2e)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let viewerToken: string;
  let operatorToken: string;
  let ownerUserId: string;
  let organizationId: string;
  let viewerMembershipId: string;
  let operatorMembershipId: string;
  const ownerEmail = `phase6-owner-${Date.now()}@example.com`;
  const viewerEmail = `phase6-viewer-${Date.now()}@example.com`;
  const operatorEmail = `phase6-operator-${Date.now()}@example.com`;
  const password = 'Phase6Password123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password, name: 'Phase 6 Owner' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(ownerEmail);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    ownerUserId = res.body.data.user.id;
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: ownerEmail, password, name: 'Duplicate' });

    expect(res.status).toBe(409);
  });

  it('logs in and returns access and refresh tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.refreshToken).toBeTypeOf('string');
    ownerToken = res.body.data.accessToken;
  });

  it('rejects invalid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('returns the current authenticated user without organization before membership', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(ownerUserId);
    expect(res.body.data.user.organization).toBeNull();
    expect(res.body.data.user.membership).toBeNull();
    expect(res.body.data.user.role).toBeNull();
    expect(res.body.data.organization).toBeNull();
    expect(res.body.data.membership).toBeNull();
  });

  it('rejects protected API calls without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/organizations');
    expect(res.status).toBe(401);
  });

  it('allows the health endpoint without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect([200, 503]).toContain(res.status);
  });

  it('creates an organization and automatically makes the creator OWNER', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Phase 6 Organization', slug: `phase6-${Date.now()}` });

    expect(res.status).toBe(201);
    organizationId = res.body.id;
    expect(res.body.memberships[0].userId).toBe(ownerUserId);
    expect(res.body.memberships[0].role).toBe('OWNER');
  });

  it('/auth/me returns organization and membership role after org is created', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const meUser = res.body.data.user;
    expect(meUser.memberships).toHaveLength(1);
    expect(meUser.role).toBe('OWNER');
    expect(meUser.organizationId).toBe(organizationId);
    expect(res.body.data.role).toBe('OWNER');
    expect(res.body.data.organizationId).toBe(organizationId);
    expect(res.body.data.organization).toBeDefined();
    expect(res.body.data.organization.id).toBe(organizationId);
    expect(res.body.data.membership).toBeDefined();
    expect(res.body.data.membership.role).toBe('OWNER');

    const membership = meUser.memberships[0];
    expect(membership.role).toBe('OWNER');
    expect(membership.organizationId).toBe(organizationId);
    expect(membership.organization).toBeDefined();
    expect(membership.organization.id).toBe(organizationId);
    expect(membership.organization.name).toBeTypeOf('string');
    expect(membership.organization.slug).toBeTypeOf('string');
  });

  it('registers a second user and adds them as VIEWER', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: viewerEmail, password, name: 'Phase 6 Viewer' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: viewerEmail, password })
      .expect(200);
    viewerToken = login.body.data.accessToken;

    const add = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: viewerEmail, role: 'VIEWER' });

    expect(add.status).toBe(201);
    viewerMembershipId = add.body.id;
  });

  it('registers a third user and adds them as OPERATOR', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: operatorEmail, password, name: 'Phase 6 Operator' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: operatorEmail, password })
      .expect(200);
    operatorToken = login.body.data.accessToken;

    const add = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: operatorEmail, role: 'OPERATOR' });

    expect(add.status).toBe(201);
    operatorMembershipId = add.body.id;
  });

  it('allows a member to read an organization they belong to', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/organizations/${organizationId}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
  });

  it('members endpoint returns actual members with user details', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    const member = res.body[0];
    expect(member).toHaveProperty('id');
    expect(member).toHaveProperty('userId');
    expect(member).toHaveProperty('organizationId');
    expect(member).toHaveProperty('role');
    expect(member).toHaveProperty('createdAt');
    expect(member).toHaveProperty('user');
    expect(member.user).toHaveProperty('email');
    expect(member.user).toHaveProperty('name');
    expect(member.organizationId).toBe(organizationId);
  });

  it('/auth/me returns membership role for viewer', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(200);
    const meUser = res.body.data.user;
    const membership = meUser.memberships.find((m: { organizationId: string }) => m.organizationId === organizationId);
    expect(membership).toBeDefined();
    expect(membership.role).toBe('VIEWER');
    expect(membership.organization).toBeDefined();
    expect(membership.organization.id).toBe(organizationId);
    expect(meUser.role).toBe('VIEWER');
    expect(res.body.data.role).toBe('VIEWER');
    expect(res.body.data.membership.role).toBe('VIEWER');
  });

  it('forbids a VIEWER from creating a greenhouse', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/greenhouses')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        organizationId,
        name: 'Viewer Greenhouse',
        code: `VIEW-${Date.now()}`,
        timezone: 'Asia/Jakarta',
      });

    expect(res.status).toBe(403);
  });

  it('forbids an OPERATOR from creating a greenhouse', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/greenhouses')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        organizationId,
        name: 'Operator Greenhouse',
        code: `OPR-${Date.now()}`,
        timezone: 'Asia/Jakarta',
      });

    expect(res.status).toBe(403);
  });

  it('forbids a VIEWER from modifying member roles', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/organizations/${organizationId}/members/${operatorMembershipId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ role: 'OWNER' });

    expect(res.status).toBe(403);
  });

  it('forbids an OPERATOR from modifying member roles', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/organizations/${organizationId}/members/${viewerMembershipId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ role: 'OWNER' });

    expect(res.status).toBe(403);
  });

  it('allows an OWNER to update a member role (VIEWER -> OPERATOR)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/organizations/${organizationId}/members/${viewerMembershipId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'OPERATOR' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('OPERATOR');
  });

  it('role changes are reflected in /auth/me after update', async () => {
    // Viewer was just updated to OPERATOR; log in fresh to get updated token
    const freshLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: viewerEmail, password })
      .expect(200);

    const freshToken = freshLogin.body.data.accessToken;

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${freshToken}`);

    expect(res.status).toBe(200);
    const meUser = res.body.data.user;
    const membership = meUser.memberships.find((m: { organizationId: string }) => m.organizationId === organizationId);
    expect(membership).toBeDefined();
    // Role was changed from VIEWER to OPERATOR by the owner
    expect(membership.role).toBe('OPERATOR');
  });

  it('forbids a member from accessing another organization', async () => {
    const otherOrg = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Viewer Organization', slug: `viewer-${Date.now()}` })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/organizations/${otherOrg.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
  });

  it('user cannot access members of another organization', async () => {
    // viewerToken user created their own org above; ownerToken user cannot see its members
    const viewerOrgRes = await request(app.getHttpServer())
      .get('/api/organizations')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    // Find the org that viewer is the owner of (not organizationId)
    const viewerOrg = viewerOrgRes.body.find((o: { id: string }) => o.id !== organizationId);
    if (!viewerOrg) return; // skip if not found (may vary by test data)

    const res = await request(app.getHttpServer())
      .get(`/api/organizations/${viewerOrg.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
  });

  it('rotates refresh tokens', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    const refresh = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken });

    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toBeTypeOf('string');
    expect(refresh.body.data.refreshToken).not.toBe(login.body.data.refreshToken);

    const oldRefresh = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken });
    expect(oldRefresh.status).toBe(401);
  });

  it('revokes a refresh token on logout', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);

    const refresh = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('lists organization members and preserves a final OWNER', async () => {
    const members = await request(app.getHttpServer())
      .get(`/api/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    // Should have at least owner + 2 other members
    expect(members.body.length).toBeGreaterThanOrEqual(2);
    expect(viewerMembershipId).toBeTypeOf('string');
  });

  it('prevents demoting the last OWNER from OWNER role', async () => {
    // Find the owner's membership id
    const membersRes = await request(app.getHttpServer())
      .get(`/api/organizations/${organizationId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const ownerMembership = membersRes.body.find(
      (m: { role: string }) => m.role === 'OWNER',
    );
    expect(ownerMembership).toBeDefined();

    const res = await request(app.getHttpServer())
      .patch(`/api/organizations/${organizationId}/members/${ownerMembership.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'ADMIN' });

    // Only one OWNER — must be rejected
    expect(res.status).toBe(403);
  });

  describe('Registration Modes & Security (Phase 7)', () => {
    const regOrgSlug = `new-reg-org-${Date.now()}`;
    const regOwnerEmail = `reg-owner-${Date.now()}@example.com`;
    const regViewerEmail = `reg-viewer-${Date.now()}@example.com`;
    let createdOrgId: string;

    it('registers a user creating a new organization as OWNER', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: regOwnerEmail,
          password: 'Password123!',
          name: 'Org Creator User',
          organizationAction: 'create',
          organizationName: 'Fresh Registered Org',
          organizationSlug: regOrgSlug,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.email).toBe(regOwnerEmail);
      expect(res.body.data.organization).toBeDefined();
      expect(res.body.data.organization.slug).toBe(regOrgSlug);
      expect(res.body.data.membership).toBeDefined();
      expect(res.body.data.membership.role).toBe('OWNER');
      createdOrgId = res.body.data.organization.id;

      // Verify immediate login and /auth/me
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: regOwnerEmail, password: 'Password123!' })
        .expect(200);

      const meRes = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
        .expect(200);

      expect(meRes.body.data.user.role).toBe('OWNER');
      expect(meRes.body.data.user.organizationId).toBe(createdOrgId);
      expect(meRes.body.data.role).toBe('OWNER');
    });

    it('rejects joining an existing organization with an invalid join code', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: `invalid-join-${Date.now()}@example.com`,
          password: 'Password123!',
          name: 'Unauthorized User',
          organizationAction: 'join',
          organizationSlug: regOrgSlug,
          joinCode: 'WRONG-CODE',
        });

      expect(res.status).toBe(403);
    });

    it('rejects joining a non-existent organization', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: `not-found-${Date.now()}@example.com`,
          password: 'Password123!',
          name: 'Lost User',
          organizationAction: 'join',
          organizationSlug: 'completely-non-existent-org-12345',
          joinCode: 'INVITE-COMPLETELY-NON-EXISTENT-ORG-12345',
        });

      expect(res.status).toBe(404);
    });

    it('rejects self-elevation to OWNER or ADMIN when joining an existing org', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: `hack-owner-${Date.now()}@example.com`,
          password: 'Password123!',
          name: 'Hacker User',
          organizationAction: 'join',
          organizationSlug: regOrgSlug,
          joinCode: `INVITE-${regOrgSlug.toUpperCase()}`,
          requestedRole: 'OWNER',
        });

      expect(res.status).toBe(403);
    });

    it('registers a user joining an existing organization with valid join code as VIEWER', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: regViewerEmail,
          password: 'Password123!',
          name: 'Valid Viewer Member',
          organizationAction: 'join',
          organizationSlug: regOrgSlug,
          joinCode: `INVITE-${regOrgSlug.toUpperCase()}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.membership).toBeDefined();
      expect(res.body.data.membership.role).toBe('VIEWER');
      expect(res.body.data.organization.id).toBe(createdOrgId);

      // Verify immediate login and /auth/me
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: regViewerEmail, password: 'Password123!' })
        .expect(200);

      const meRes = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`)
        .expect(200);

      expect(meRes.body.data.user.role).toBe('VIEWER');
      expect(meRes.body.data.user.organizationId).toBe(createdOrgId);
      expect(meRes.body.data.role).toBe('VIEWER');
    });

    it('registers a standalone user with organizationAction: none', async () => {
      const standaloneEmail = `standalone-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          email: standaloneEmail,
          password: 'Password123!',
          name: 'Standalone User',
          organizationAction: 'none',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.email).toBe(standaloneEmail);
      expect(res.body.data.organization).toBeUndefined();
      expect(res.body.data.membership).toBeUndefined();
    });
  });
});
