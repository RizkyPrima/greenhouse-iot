import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmqxAuthorizationRule {
  permission: 'allow';
  action: 'publish' | 'subscribe' | 'all';
  topic: string;
}

@Injectable()
export class EmqxManagementService {
  constructor(private readonly config: ConfigService) {}

  async provisionUser(
    username: string,
    password: string,
    rules: EmqxAuthorizationRule[],
  ): Promise<void> {
    const userPath = `authentication/password_based:built_in_database/users/${encodeURIComponent(username)}`;
    const authorizationPath = `authorization/sources/built_in_database/rules/users/${encodeURIComponent(username)}`;

    await this.request('PUT', authorizationPath, { rules: [] }, [404]);

    const userStatus = await this.request(
      'POST',
      'authentication/password_based:built_in_database/users',
      { user_id: username, password, is_superuser: false },
      [409],
    );
    if (userStatus === 409) {
      await this.request('PUT', userPath, { password, is_superuser: false });
    }

    const authorizationStatus = await this.request(
      'PUT',
      authorizationPath,
      { rules },
      [404],
    );
    if (authorizationStatus === 404) {
      const createAuthorizationStatus = await this.request(
        'POST',
        'authorization/sources/built_in_database/rules/users',
        {
        username,
        rules,
        },
        [409],
      );
      if (createAuthorizationStatus === 409) {
        await this.request('PUT', authorizationPath, { rules });
      }
    }
  }

  async revokeUser(username: string): Promise<void> {
    const encodedUsername = encodeURIComponent(username);
    await this.request(
      'DELETE',
      `authorization/sources/built_in_database/rules/users/${encodedUsername}`,
      undefined,
      [404],
    );
    await this.request(
      'DELETE',
      `authentication/password_based:built_in_database/users/${encodedUsername}`,
      undefined,
      [404],
    );
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    acceptedStatuses: number[] = [],
  ): Promise<number> {
    const apiUrl = this.config.get<string>('mqtt.managementUrl');
    const apiKey = this.config.get<string>('mqtt.managementKey');
    const apiSecret = this.config.get<string>('mqtt.managementSecret');
    if (!apiUrl || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('EMQX management API credentials are not configured');
    }

    const nodeEnv = this.config.get<string>('app.nodeEnv');
    const baseUrl = new URL(apiUrl);
    if (nodeEnv === 'production' && baseUrl.protocol !== 'https:') {
      throw new ServiceUnavailableException('EMQX management API must use HTTPS in production');
    }

    let response: Response;
    try {
      response = await fetch(new URL(path, `${apiUrl.replace(/\/+$/, '')}/`), {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ServiceUnavailableException('Unable to reach the EMQX management API');
    }

    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      throw new ServiceUnavailableException(
        `EMQX management API rejected the request (HTTP ${response.status})`,
      );
    }
    return response.status;
  }
}
