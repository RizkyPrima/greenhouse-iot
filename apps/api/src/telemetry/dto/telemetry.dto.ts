import { IsString, IsOptional, IsNumber, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class SensorReadingDto {
  @IsString()
  code!: string;

  @IsNumber()
  value!: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

export class TelemetryPayloadDto {
  @IsOptional()
  @IsNumber()
  seq?: number;

  @IsOptional()
  @IsNumber()
  ts?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SensorReadingDto)
  sensors!: SensorReadingDto[];
}

export class TelemetryQueryDto {
  @IsOptional()
  @IsString()
  deviceMqttId?: string;

  @IsOptional()
  @IsString()
  greenhouseId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}

export class TelemetryRecordResponseDto {
  id!: string;
  deviceId!: string;
  deviceMqttId!: string;
  greenhouseId!: string;
  sequenceNumber?: number | null;
  receivedAt!: string;
  processedAt?: string | null;
  valuesCount!: number;
}

export class TelemetryValueResponseDto {
  id!: string;
  sensorCode!: string;
  sensorId?: string | null;
  numericValue?: number | null;
  stringValue?: string | null;
  unit?: string | null;
  timestamp!: string;
}

export class RealtimeDeviceStateDto {
  deviceMqttId!: string;
  greenhouseId!: string;
  status!: string;
  lastSeenAt!: string;
  lastTelemetryAt?: string | null;
  sensors!: Record<string, {
    code: string;
    value: number | null;
    stringValue: string | null;
    unit: string | null;
    timestamp: string;
  }>;
}