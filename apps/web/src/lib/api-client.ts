import {
  User, Organization, OrganizationMember, UserMembership, Greenhouse, Zone, Device, Sensor, Actuator,
  RealtimeDeviceState, TelemetryRecord, PlantCatalog, PlantCatalogVersion, PlantProfile, PlantProfileVersion,
  GrowthStage, PlantParameterDefinition, PlatformAdminGrant, PlantConfigAuditEvent, ZonePlantAssignment,
  ZoneParameterOverride, ZonePlantAssignmentDetails, EffectiveZonePlantConfig, CreatePlantCatalogDto, CreatePlantCatalogVersionDto,
  UpdatePlantCatalogVersionDto, CreatePlantParameterDefinitionDto, UpdatePlantParameterDefinitionDto,
  CreatePlantProfileDto, UpdatePlantProfileDraftDto, CreateDraftGrowthStageDto, UpdateGrowthStageDto,
  AdoptPlantCatalogVersionDto, ActivatePlantProfileDto, CreateZoneOverrideDto, CreatePlatformGrantDto,
  PlatformCapabilities, PlantAiProposalRecord,
  PlantRecommendationResult, PlantScientificEvidenceRecord, GeneratePlantSetupDto, PlantSetupCandidateResult,
  PlantConfigurationDevice, DevicePlantConfigurationDelivery,
} from '@/types';

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
      let errorCode: string | undefined;
      let currentRevision: number | undefined;
      try {
        const errorData = await response.json();
        if (errorData.message && typeof errorData.message === 'object') {
          errorCode = errorData.message.code || errorData.code;
          currentRevision = errorData.message.currentRevision;
          errorMsg = errorData.message.message || errorCode || JSON.stringify(errorData.message);
        } else {
          errorCode = errorData.code;
          errorMsg = errorData.message || errorData.error || errorMsg;
        }
      } catch {
        // use default errorMsg
      }
      const error: Error & { status?: number; code?: string; currentRevision?: number } = new Error(errorMsg);
      error.status = response.status;
      error.code = errorCode;
      error.currentRevision = currentRevision;
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

  async getPlatformCapabilities(): Promise<{ data: { capabilities: PlatformCapabilities } }> {
    return this.request('/auth/capabilities');
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

  async getPlantConfigurationDevices(organizationId: string): Promise<PlantConfigurationDevice[]> {
    return this.request<PlantConfigurationDevice[]>(`/organizations/${encodeURIComponent(organizationId)}/plant-config-devices`);
  }

  async applyDevicePlantConfiguration(
    organizationId: string,
    deviceId: string,
    payload: { configurationId: string; catalogVersionId: string; parameterKeys: string[] },
  ): Promise<DevicePlantConfigurationDelivery> {
    return this.request<DevicePlantConfigurationDelivery>(`/organizations/${encodeURIComponent(organizationId)}/devices/${encodeURIComponent(deviceId)}/plant-configurations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getDevicePlantConfiguration(
    organizationId: string,
    configurationId: string,
  ): Promise<DevicePlantConfigurationDelivery> {
    return this.request<DevicePlantConfigurationDelivery>(`/organizations/${encodeURIComponent(organizationId)}/device-plant-configurations/${encodeURIComponent(configurationId)}`);
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

  // ── Plant Standardization Endpoints ──────────────────────────────────────
  async getPlantCatalog(organizationId: string): Promise<PlantCatalog[]> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog`);
  }

  async getPlantCatalogItem(organizationId: string, catalogId: string): Promise<PlantCatalog> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/${encodeURIComponent(catalogId)}`);
  }

  async createPlantCatalog(organizationId: string, payload: CreatePlantCatalogDto): Promise<PlantCatalog> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async createPlantCatalogVersion(organizationId: string, catalogId: string, payload: CreatePlantCatalogVersionDto): Promise<PlantCatalogVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/${encodeURIComponent(catalogId)}/versions`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async updatePlantCatalogVersion(organizationId: string, versionId: string, payload: UpdatePlantCatalogVersionDto): Promise<PlantCatalogVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/versions/${encodeURIComponent(versionId)}/draft`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async createPlantParameterDefinition(organizationId: string, versionId: string, payload: CreatePlantParameterDefinitionDto): Promise<PlantParameterDefinition> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/versions/${encodeURIComponent(versionId)}/parameters`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async updatePlantParameterDefinition(organizationId: string, versionId: string, parameterId: string, payload: UpdatePlantParameterDefinitionDto): Promise<PlantParameterDefinition> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/versions/${encodeURIComponent(versionId)}/parameters/${encodeURIComponent(parameterId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async deletePlantParameterDefinition(organizationId: string, versionId: string, parameterId: string): Promise<{ id: string; deleted: true }> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/versions/${encodeURIComponent(versionId)}/parameters/${encodeURIComponent(parameterId)}`, { method: 'DELETE' });
  }

  async publishPlantCatalogVersion(organizationId: string, versionId: string): Promise<PlantCatalogVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-catalog/versions/${encodeURIComponent(versionId)}/publish`, { method: 'POST' });
  }

  async getPlantProposals(organizationId: string): Promise<PlantAiProposalRecord[]> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-ai-proposals`);
  }

  async decidePlantProposal(organizationId: string, proposalId: string, decision: 'approve' | 'reject', reason: string): Promise<PlantAiProposalRecord> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-ai-proposals/${encodeURIComponent(proposalId)}/${decision}`, { method: 'POST', body: JSON.stringify({ reason }) });
  }

  async applyPlantProposal(organizationId: string, proposalId: string): Promise<PlantCatalogVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-ai-proposals/${encodeURIComponent(proposalId)}/apply`, { method: 'POST' });
  }

  async verifyPlantEvidence(evidenceId: string, reason: string) {
    return this.request(`/scientific-evidence/${encodeURIComponent(evidenceId)}/verify`, { method: 'POST', body: JSON.stringify({ reason }) });
  }

  async getPlantEvidence(organizationId: string): Promise<PlantScientificEvidenceRecord[]> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/scientific-evidence`);
  }

  async createPlantEvidence(organizationId: string, contract: Record<string, unknown>): Promise<PlantScientificEvidenceRecord> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/scientific-evidence`, { method: 'POST', body: JSON.stringify({ contract }) });
  }

  async createPlatformAdminGrant(payload: CreatePlatformGrantDto): Promise<PlatformAdminGrant> {
    return this.request('/platform-admin-grants', { method: 'POST', body: JSON.stringify(payload) });
  }

  async revokePlatformAdminGrant(grantId: string): Promise<PlatformAdminGrant> {
    return this.request(`/platform-admin-grants/${encodeURIComponent(grantId)}/revoke`, { method: 'PATCH' });
  }

  async getPlantProfiles(organizationId: string): Promise<PlantProfile[]> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profiles`);
  }

  async getPlantProfile(organizationId: string, profileId: string): Promise<PlantProfile> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profiles/${encodeURIComponent(profileId)}`);
  }

  async createPlantRecommendation(organizationId: string, profileId: string, payload: { profileVersionId: string; growthStageId: string }): Promise<PlantRecommendationResult> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profiles/${encodeURIComponent(profileId)}/recommendations`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async generatePlantSetup(organizationId: string, payload: GeneratePlantSetupDto): Promise<PlantSetupCandidateResult> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-setups/generate`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async createPlantProfile(organizationId: string, payload: CreatePlantProfileDto): Promise<PlantProfile> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profiles`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async createPlantProfileVersion(organizationId: string, profileId: string): Promise<PlantProfileVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profiles/${encodeURIComponent(profileId)}/versions`, { method: 'POST' });
  }

  async updatePlantProfileDraft(organizationId: string, versionId: string, payload: UpdatePlantProfileDraftDto): Promise<PlantProfileVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profile-versions/${encodeURIComponent(versionId)}/draft`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async createGrowthStage(organizationId: string, versionId: string, payload: CreateDraftGrowthStageDto): Promise<GrowthStage> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profile-versions/${encodeURIComponent(versionId)}/stages`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async updateGrowthStage(organizationId: string, stageId: string, payload: UpdateGrowthStageDto): Promise<GrowthStage> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/growth-stages/${encodeURIComponent(stageId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async adoptPlantCatalogVersion(organizationId: string, profileId: string, payload: AdoptPlantCatalogVersionDto): Promise<PlantProfileVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profiles/${encodeURIComponent(profileId)}/adoptions`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async validatePlantProfileVersion(organizationId: string, versionId: string, expectedRevision: number): Promise<PlantProfileVersion> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-profile-versions/${encodeURIComponent(versionId)}/validate`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    });
  }

  async getPlantConfigAudit(organizationId: string): Promise<PlantConfigAuditEvent[]> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-config-audit`);
  }

  async activatePlantProfileInZone(zoneId: string, payload: ActivatePlantProfileDto, idempotencyKey: string): Promise<ZonePlantAssignment> {
    return this.request(`/zones/${encodeURIComponent(zoneId)}/plant-assignments`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  }

  async getZonePlantAssignments(zoneId: string): Promise<ZonePlantAssignmentDetails[]> {
    return this.request(`/zones/${encodeURIComponent(zoneId)}/plant-assignments`);
  }

  async createZoneParameterOverride(assignmentId: string, payload: CreateZoneOverrideDto): Promise<ZoneParameterOverride> {
    return this.request(`/plant-assignments/${encodeURIComponent(assignmentId)}/overrides`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async deactivateZonePlantAssignment(organizationId: string, assignmentId: string, idempotencyKey: string): Promise<ZonePlantAssignment> {
    return this.request(`/organizations/${encodeURIComponent(organizationId)}/plant-assignments/${encodeURIComponent(assignmentId)}/deactivate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  async getEffectiveZonePlantConfig(assignmentId: string): Promise<EffectiveZonePlantConfig> {
    return this.request(`/plant-assignments/${encodeURIComponent(assignmentId)}/effective-config`);
  }

  // ── Health Endpoints ─────────────────────────────────────────────────────
  async getHealth(): Promise<{ status: string; info?: Record<string, unknown>; details?: Record<string, unknown> }> {
    return this.request('/health');
  }
}

export const apiClient = new ApiClient();
