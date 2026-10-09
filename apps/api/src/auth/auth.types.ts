import type { UserRole } from '@prisma/client';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

export interface MembershipSummary {
  id: string;
  organizationId: string;
  role: UserRole;
  createdAt: string;
  organization: OrganizationSummary;
}

export interface JwtAccessPayload {
  sub: string;
  type: 'access';
}

export interface JwtRefreshPayload {
  sub: string;
  sid: string;
  type: 'refresh';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  organizationId: string | null;
  membershipId: string | null;
  role: UserRole | null;
  memberships: MembershipSummary[];
  /**
   * Convenience context for the dashboard.
   * This is derived from the active organization membership and is never
   * accepted from the client as an authorization source.
   */
  organization: OrganizationSummary | null;
  membership: MembershipSummary | null;
}

