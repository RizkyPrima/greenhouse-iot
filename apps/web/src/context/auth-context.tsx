'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { User, Organization, UserRole, UserMembership } from '@/types';
import { apiClient } from '@/lib/api-client';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  organizations: Organization[];
  currentOrg: Organization | null;
  currentRole: UserRole | null;
  currentMembership: UserMembership | null;
  setCurrentOrgId: (orgId: string) => void;
  register: (payload: {
    email: string;
    password: string;
    name: string;
    organizationAction?: 'create' | 'join' | 'none';
    organizationName?: string;
    organizationSlug?: string;
    joinCode?: string;
    requestedRole?: string;
  }) => Promise<void>;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const loadUserData = useCallback(async () => {
    try {
      const token = apiClient.getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      const res = await apiClient.getMe();
      const userData = res.data.user;
      setUser(userData);

      // Derive orgs from enriched memberships (organization field embedded by /api/auth/me)
      const orgsFromMemberships: Organization[] = (userData.memberships || [])
        .filter((m) => m.organization != null)
        .map((m) => ({
          id: m.organization!.id,
          name: m.organization!.name,
          slug: m.organization!.slug,
          description: m.organization!.description,
          createdAt: m.organization!.createdAt,
          updatedAt: m.organization!.updatedAt,
        }));

      // Also include active organization if present on user or response root
      const activeOrg = res.data.organization ?? userData.organization;
      if (activeOrg && !orgsFromMemberships.some((o) => o.id === activeOrg.id)) {
        orgsFromMemberships.unshift(activeOrg);
      }

      if (orgsFromMemberships.length > 0) {
        setOrganizations(orgsFromMemberships);
        const savedOrgId = typeof window !== 'undefined' ? localStorage.getItem('greenhouse_selected_org') : null;
        let selectedId = orgsFromMemberships[0].id;
        if (savedOrgId && orgsFromMemberships.some((o) => o.id === savedOrgId)) {
          selectedId = savedOrgId;
        } else if (userData.organizationId && orgsFromMemberships.some((o) => o.id === userData.organizationId)) {
          selectedId = userData.organizationId;
        }
        setCurrentOrgIdState(selectedId);
        if (typeof window !== 'undefined') {
          localStorage.setItem('greenhouse_selected_org', selectedId);
        }
      } else {
        // Fallback: fetch orgs separately (e.g. user has memberships but org embed failed)
        try {
          const orgs = await apiClient.getOrganizations();
          setOrganizations(orgs);
          const savedOrgId = typeof window !== 'undefined' ? localStorage.getItem('greenhouse_selected_org') : null;
          if (savedOrgId && orgs.some((o) => o.id === savedOrgId)) {
            setCurrentOrgIdState(savedOrgId);
          } else if (orgs.length > 0) {
            setCurrentOrgIdState(orgs[0].id);
            if (typeof window !== 'undefined') {
              localStorage.setItem('greenhouse_selected_org', orgs[0].id);
            }
          }
        } catch {
          // orgs fetch may fail — user may have no org yet
        }
      }
    } catch {
      apiClient.clearTokens();
      setUser(null);
      setOrganizations([]);
      setCurrentOrgIdState(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUserData();
  }, [loadUserData]);

  // Auth redirect protection
  useEffect(() => {
    if (!isLoading) {
      const isAuthPage = pathname === '/login' || pathname === '/register';
      if (!user && !isAuthPage) {
        router.push('/login');
      } else if (user && isAuthPage) {
        router.push('/dashboard');
      }
    }
  }, [user, isLoading, pathname, router]);

  const setCurrentOrgId = useCallback((orgId: string) => {
    setCurrentOrgIdState(orgId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('greenhouse_selected_org', orgId);
    }
  }, []);

  const currentOrg = useMemo(() => {
    if (organizations.length === 0) return user?.organization ?? null;
    if (currentOrgId) {
      const match = organizations.find((o) => o.id === currentOrgId);
      if (match) return match;
    }
    return user?.organization ?? organizations[0] ?? null;
  }, [currentOrgId, organizations, user]);

  const currentMembership = useMemo(() => {
    if (!user) return null;
    if (currentOrg) {
      const match = user.memberships?.find((m) => m.organizationId === currentOrg.id);
      if (match) return match;
    }
    return user.membership ?? (user.memberships?.[0] ?? null);
  }, [user, currentOrg]);

  const currentRole = useMemo(() => {
    return currentMembership?.role ?? user?.role ?? null;
  }, [currentMembership, user]);

  const hasRole = useCallback(
    (...roles: UserRole[]): boolean => {
      if (!currentRole) return false;
      return roles.includes(currentRole);
    },
    [currentRole],
  );

  const register = async (payload: {
    email: string;
    password: string;
    name: string;
    organizationAction?: 'create' | 'join' | 'none';
    organizationName?: string;
    organizationSlug?: string;
    joinCode?: string;
    requestedRole?: string;
  }) => {
    setIsLoading(true);
    try {
      await apiClient.register(payload);
      // Automatically log in upon successful registration
      await apiClient.login({ email: payload.email, password: payload.password });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('greenhouse_selected_org');
      }
      await loadUserData();
      router.push('/dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (credentials: { email: string; password: string }) => {
    setIsLoading(true);
    try {
      await apiClient.login(credentials);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('greenhouse_selected_org');
      }
      await loadUserData();
      router.push('/dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiClient.logout();
      if (typeof window !== 'undefined') {
        localStorage.removeItem('greenhouse_selected_org');
      }
      setUser(null);
      setOrganizations([]);
      setCurrentOrgIdState(null);
      router.push('/login');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async () => {
    await loadUserData();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        organizations,
        currentOrg,
        currentRole,
        currentMembership,
        setCurrentOrgId,
        register,
        login,
        logout,
        refreshUser,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
