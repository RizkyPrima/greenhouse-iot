import { User, Organization, OrganizationMember, UserMembership, Greenhouse, Zone, Device, Sensor, Actuator, RealtimeDeviceState, TelemetryRecord } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private isRefreshing = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('greenhouse_access_token');
      this.refreshToken = localStorage.getItem('greenhouse_refresh_token');
    }
  }

  setTokens(accessToken: string | null, refreshToken: string | null) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (typeof window !== 'undefined') {
      if (accessToken) {
        localStorage.setItem('greenhouse_access_token', accessToken);
      } else {
        localStorage.removeItem('greenhouse_access_token');
      }

      if (refreshToken) {
        localStorage.setItem('greenhouse_refresh_token', refreshToken);
      } else {
        localStorage.removeItem('greenhouse_refresh_token');
      }
    }
  }

  getAccessToken(): string | null {
    if (!this.accessToken && typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('greenhouse_access_token');
    }
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    if (!this.refreshToken && typeof window !== 'undefined') {
      this.refreshToken = localStorage.getItem('greenhouse_refresh_token');
    }
    return this.refreshToken;
  }

  clearTokens() {
    this.setTokens(null, null);
  }

  private async tryRefreshToken(): Promise<string | null> {
    const currentRefresh = this.getRefreshToken();
    if (!currentRefresh) {
      this.clearTokens();
      return null;
    }

    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: currentRefresh }),
        });

        if (!response.ok) {
          this.clearTokens();
          return null;
        }

        const json = await response.json();
        const { accessToken, refreshToken } = json.data;
        this.setTokens(accessToken, refreshToken);
        return accessToken;
      } catch {
        this.clearTokens();
        return null;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const token = this.getAccessToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response = await fetch(url, { ...options, headers });

    // Handle token expiration
    if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
      const newToken = await this.tryRefreshToken();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(url, { ...options, headers });
      }
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.message || errorData.error || errorMsg;
      } catch {
        // use default errorMsg
      }
      const error: Error & { status?: number } = new Error(errorMsg);
      error.status = response.status;
      throw error;
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // ── Auth Endpoints ────────────────────────────────────────────────────────
  async register(payload: {
    email: string;
    password: string;
    name: string;
    organizationAction?: 'create' | 'join' | 'none';
    organizationName?: string;
    organizationSlug?: string;
    joinCode?: string;
    requestedRole?: string;
  }) {
    return this.request<{ data: { user: User; organization?: Organization } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async login(credentials: { email: string; password: string }) {
    const res = await this.request<{ data: { accessToken: string; refreshToken: string; user: User } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    this.setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data;
  }

  async logout() {
    const refreshToken = this.getRefreshToken();
    if (refreshToken) {
      try {
        await this.request('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // ignore logout errors
      }
    }
    this.clearTokens();
  }

  async getMe(): Promise<{ data: { user: User; organization?: Organization | null; membership?: UserMembership | null } }> {
    return this.request<{ data: { user: User; organization?: Organization | null; membership?: UserMembership | null } }>('/auth/me');
  }

  // ── Organizations Endpoints ──────────────────────────────────────────────
  async getOrganizations(): Promise<Organization[]> {
    return this.request<Organization[]>('/organizations');
  }

  async getOrganization(id: string): Promise<Organization> {
    return this.request<Organization>(`/organizations/${id}`);
  }

  async getOrganizationMembers(id: string): Promise<OrganizationMember[]> {
    return this.request<OrganizationMember[]>(`/organizations/${id}/members`);
  }

  async addMember(organizationId: string, payload: { email: string; role: string }): Promise<OrganizationMember> {
    return this.request<OrganizationMember>(`/organizations/${organizationId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateMemberRole(organizationId: string, membershipId: string, role: string): Promise<OrganizationMember> {
    return this.request<OrganizationMember>(`/organizations/${organizationId}/members/${membershipId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  // ── Greenhouses Endpoints ────────────────────────────────────────────────
  async getGreenhouses(organizationId?: string): Promise<Greenhouse[]> {
    const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : '';
    return this.request<Greenhouse[]>(`/greenhouses${qs}`);
  }

  async getGreenhouse(id: string): Promise<Greenhouse> {
    return this.request<Greenhouse>(`/greenhouses/${id}`);
  }

  async getGreenhouseZones(id: string): Promise<Zone[]> {
    return this.request<Zone[]>(`/greenhouses/${id}/zones`);
  }

  async createGreenhouse(payload: { organizationId: string; name: string; code: string; location?: string; timezone: string }): Promise<Greenhouse> {
    return this.request<Greenhouse>('/greenhouses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateGreenhouse(id: string, payload: Partial<Greenhouse>): Promise<Greenhouse> {
    return this.request<Greenhouse>(`/greenhouses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  // ── Zones Endpoints ──────────────────────────────────────────────────────
  async getZones(): Promise<Zone[]> {
    return this.request<Zone[]>('/zones');
  }

  // ── Devices Endpoints ────────────────────────────────────────────────────
  async getDevices(organizationId?: string): Promise<Device[]> {
    const qs = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : '';
    return this.request<Device[]>(`/devices${qs}`);
  }

  async getDevice(id: string): Promise<Device> {
    return this.request<Device>(`/devices/${id}`);
  }

  async getDeviceSensors(id: string): Promise<Sensor[]> {
    return this.request<Sensor[]>(`/devices/${id}/sensors`);
  }

  async getDeviceActuators(id: string): Promise<Actuator[]> {
    return this.request<Actuator[]>(`/devices/${id}/actuators`);
  }

  async getActuators(): Promise<Actuator[]> {
    return this.request<Actuator[]>('/actuators');
  }

  async sendActuatorCommand(actuatorId: string, command: 'ON' | 'OFF') {
    return this.request<{ commandId: string; status: string }>(`/actuators/${actuatorId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async getActuatorCommand(commandId: string) {
    return this.request<{
      commandId: string;
      actuatorId: string | null;
      target: string;
      value: boolean;
      status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'EXECUTED' | 'FAILED' | 'TIMEOUT';
      result?: { activeState?: boolean } | null;
      error?: string | null;
    }>(`/actuators/commands/${commandId}`);
  }

  async getLatestActuatorStates() {
    return this.request<Array<{ actuatorId: string; activeState: boolean; updatedAt: string }>>('/actuators/states');
  }

  // ── Telemetry Endpoints ──────────────────────────────────────────────────
  async getGreenhouseRealtime(greenhouseId: string): Promise<{ greenhouseId: string; deviceCount: number; devices: RealtimeDeviceState[] }> {
    return this.request(`/greenhouses/${greenhouseId}/telemetry/latest`);
  }

  async getDeviceRealtime(deviceMqttId: string): Promise<{ data: RealtimeDeviceState | null; cached: boolean }> {
    return this.request(`/devices/${deviceMqttId}/telemetry/latest`);
  }

  async getDeviceHistory(deviceMqttId: string, params?: { limit?: number; from?: string; to?: string }): Promise<{ deviceMqttId: string; count: number; records: TelemetryRecord[] }> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    return this.request(`/devices/${deviceMqttId}/telemetry/history${qs ? `?${qs}` : ''}`);
  }

  async getGreenhouseStats(greenhouseId: string): Promise<{ greenhouseId: string; totalRecords: number; lastRecord?: { receivedAt: string; deviceMqttId: string } | null }> {
    return this.request(`/greenhouses/${greenhouseId}/telemetry/stats`);
  }

  // ── Health Endpoints ─────────────────────────────────────────────────────
  async getHealth(): Promise<{ status: string; info?: Record<string, unknown>; details?: Record<string, unknown> }> {
    return this.request('/health');
  }
}

export const apiClient = new ApiClient();
