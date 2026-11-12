import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DeviceOperatingRangeDto {
  @IsString()
  @MaxLength(64)
  parameterKey!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  minimum!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  maximum!: number;

  @IsString()
  @MaxLength(64)
  unit!: string;
}

export class ApplyDevicePlantConfigurationDto {
  @IsUUID()
  configurationId!: string;

  @IsString()
  @MaxLength(100)
  catalogVersionId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(12)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  parameterKeys!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => DeviceOperatingRangeDto)
  operatingRanges?: DeviceOperatingRangeDto[];
}
