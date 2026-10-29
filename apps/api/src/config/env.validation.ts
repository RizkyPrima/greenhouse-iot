import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Max,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
  Provisioning = 'provisioning',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  @IsOptional()
  API_HOST: string = '0.0.0.0';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  API_PORT: number = 3001;

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL is required for backend foundation' })
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  REDIS_PORT?: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  // MQTT configuration
  @IsString()
  @IsOptional()
  MQTT_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  MQTT_PORT: number = 1883;

  @IsString()
  @IsOptional()
  MQTT_PROTOCOL: string = 'mqtt';

  @IsString()
  @IsOptional()
  MQTT_USERNAME?: string;

  @IsString()
  @IsOptional()
  MQTT_PASSWORD?: string;

  @IsString()
  @IsOptional()
  LLM_API_BASE_URL?: string;

  @IsString()
  @IsOptional()
  LLM_API_KEY?: string;

  @IsString()
  @IsOptional()
  GEMINI_API_KEY?: string;

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;

  @IsString()
  @IsOptional()
  LLM_MODEL?: string;

  @IsString()
  @IsOptional()
  GEMINI_MODEL?: string;

  @IsString()
  @IsOptional()
  OPENAI_MODEL?: string;

  @IsString()
  @IsOptional()
  MQTT_CLIENT_ID: string = 'greenhouse-api';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  MQTT_KEEPALIVE: number = 30;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @IsOptional()
  MQTT_CONNECT_TIMEOUT: number = 10000;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @IsOptional()
  MQTT_RECONNECT_PERIOD: number = 3000;

  @IsOptional()
  MQTT_CLEAN: boolean = true;

  @IsString()
  @IsOptional()
  JWT_SECRET?: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_SECRET?: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN: string = '7d';
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const errorMessages = errors
      .map((err) => Object.values(err.constraints || {}).join(', '))
      .join('; ');
    throw new Error(`[Configuration Error] Environment validation failed: ${errorMessages}`);
  }

  return validatedConfig;
}
