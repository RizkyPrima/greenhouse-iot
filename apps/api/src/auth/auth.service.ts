import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type { JwtRefreshPayload, MembershipSummary } from './auth.types.js';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Unable to register with these credentials');

    const passwordHash = await argon2.hash(dto.password);
    const action = dto.organizationAction ?? (dto.organizationName ? 'create' : 'none');

    if (action === 'create') {
      const orgName = dto.organizationName?.trim();
      if (!orgName) {
        throw new BadRequestException('Organization name is required to create a new organization');
      }

      let slug = dto.organizationSlug?.trim().toLowerCase();
      if (!slug) {
        slug = slugify(orgName);
      }
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        throw new BadRequestException('Invalid organization slug format');
      }

      const existingOrg = await this.prisma.organization.findUnique({ where: { slug } });
      if (existingOrg) {
        throw new ConflictException('Organization slug already exists');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash, name: dto.name.trim() },
          select: { id: true, email: true, name: true, isActive: true, createdAt: true },
        });

        const org = await tx.organization.create({
          data: {
            name: orgName,
            slug,
            memberships: {
              create: {
                userId: user.id,
                role: UserRole.OWNER,
              },
            },
          },
          include: {
            memberships: true,
          },
        });

        const membership = org.memberships[0];
        return { user, org, membership };
      });

      return {
        data: {
          user: {
            ...result.user,
            organizationId: result.org.id,
            role: UserRole.OWNER,
          },
          organization: result.org,
          membership: result.membership,
        },
      };
    }

    if (action === 'join') {
      const slug = dto.organizationSlug?.trim().toLowerCase();
      if (!slug) {
        throw new BadRequestException('Organization slug is required to join an existing organization');
      }

      // Security requirement: Users cannot self-grant elevated roles on existing organizations
      if (dto.requestedRole && dto.requestedRole !== UserRole.VIEWER) {
        throw new ForbiddenException('Public registration cannot self-grant elevated roles on existing organizations');
      }

      if (!dto.joinCode || !dto.joinCode.trim()) {
        throw new ForbiddenException('Valid join authorization code is required to join an existing organization');
      }

      const org = await this.prisma.organization.findFirst({
        where: { slug, deletedAt: null },
        select: { id: true, name: true, slug: true, description: true },
      });
      if (!org) {
        throw new NotFoundException('Organization not found');
      }

      const expectedCode1 = `INVITE-${org.slug.toUpperCase()}`;
      const expectedCode2 = `JOIN-${org.slug.toUpperCase()}`;
      const providedCode = dto.joinCode.trim().toUpperCase();

      if (providedCode !== expectedCode1 && providedCode !== expectedCode2) {
        throw new ForbiddenException('Invalid organization join authorization code');
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash, name: dto.name.trim() },
          select: { id: true, email: true, name: true, isActive: true, createdAt: true },
        });

        const membership = await tx.organizationMembership.create({
          data: {
            userId: user.id,
            organizationId: org.id,
            role: UserRole.VIEWER,
          },
        });

        return { user, org, membership };
      });

      return {
        data: {
          user: {
            ...result.user,
            organizationId: result.org.id,
            role: UserRole.VIEWER,
          },
          organization: result.org,
          membership: result.membership,
        },
      };
    }

    const user = await this.prisma.user.create({
      data: { email, passwordHash, name: dto.name.trim() },
      select: { id: true, email: true, name: true, isActive: true, createdAt: true },
    });

    return { data: { user } };
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: this.membershipInclude() },
    });

    if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user.id);
    return { data: { ...tokens, user: this.safeUser(user) } };
  }

  async refresh(dto: RefreshTokenDto) {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.sub || !payload.sid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(dto.refreshToken);
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: payload.sid, userId: payload.sub, tokenHash, revokedAt: null },
      include: { user: { include: { memberships: this.membershipInclude() } } },
    });

    if (!session || session.expiresAt <= new Date() || !session.user.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(session.userId);
    return { data: { ...tokens, user: this.safeUser(session.user) } };
  }

  async logout(dto: RefreshTokenDto) {
    try {
      const payload = await this.jwt.verifyAsync<JwtRefreshPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (payload.type !== 'refresh' || !payload.sid) return { data: { loggedOut: true } };

      await this.prisma.refreshSession.updateMany({
        where: { id: payload.sid, tokenHash: this.hashToken(dto.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Logout is idempotent and intentionally does not disclose token validity.
    }
    return { data: { loggedOut: true } };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: this.membershipInclude() },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive or unavailable');
    }

    const safeUser = this.safeUser(user);
    return {
      data: {
        user: safeUser,
        id: safeUser.id,
        email: safeUser.email,
        name: safeUser.name,
        organizationId: safeUser.organizationId,
        membershipId: safeUser.membershipId,
        role: safeUser.role,
        organization: safeUser.organization,
        membership: safeUser.membership,
      },
    };
  }

  async capabilities(userId: string) {
    const grant = await this.prisma.platformAdminGrant.findFirst({
      where: { userId, permission: 'PLANT_CATALOG_ADMIN', revokedAt: null },
      select: { id: true },
    });

    return { data: { capabilities: { plantCatalogAdmin: Boolean(grant) } } };
  }

  private membershipInclude() {
    return {
      select: {
        id: true,
        organizationId: true,
        role: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    };
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, type: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: (this.config.get<string>('JWT_EXPIRES_IN') || '15m') as SignOptions['expiresIn'],
      },
    );

    const sessionId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, sid: sessionId, type: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d') as SignOptions['expiresIn'],
      },
    );

    const expiresAt = this.refreshExpiry();
    await this.prisma.refreshSession.create({
      data: { id: sessionId, userId, tokenHash: this.hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, expiresAt: expiresAt.toISOString() };
  }

  private refreshExpiry(): Date {
    const value = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const amount = Number(match[1]);
    const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2] as 's' | 'm' | 'h' | 'd'];
    return new Date(Date.now() + amount * unit);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeUser(user: {
    id: string;
    email: string;
    name: string;
    isActive: boolean;
    memberships: Array<{
      id: string;
      organizationId: string;
      role: MembershipSummary['role'];
      createdAt: Date;
      organization: {
        id: string;
        name: string;
        slug: string;
        description?: string | null;
      };
    }>;
  }) {
    const memberships: MembershipSummary[] = user.memberships.map((membership) => ({
      id: membership.id,
      organizationId: membership.organizationId,
      role: membership.role,
      createdAt: membership.createdAt.toISOString(),
      organization: membership.organization,
    }));

    const activeMembership = memberships[0] ?? null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      organizationId: activeMembership?.organizationId ?? null,
      membershipId: activeMembership?.id ?? null,
      role: activeMembership?.role ?? null,
      memberships,
      organization: activeMembership?.organization ?? null,
      membership: activeMembership,
    };
  }
}
