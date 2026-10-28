import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePlantCatalogDto {
  @IsString() code!: string;
  @IsString() scientificName!: string;
  @IsString() commonName!: string;
  @IsOptional() @IsString() cultivar?: string;
}

export class CreateCatalogVersionDto {
  @IsObject() profileDefaults!: Record<string, unknown>;
  @IsOptional() @IsArray() stageTemplates?: unknown[];
  @IsOptional() @IsObject() edgeCompatibility?: Record<string, unknown>;
  @IsOptional() @IsIn(['AI_PLANT_SETUP', 'MANUAL_EDIT']) changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export class UpdateCatalogVersionDto {
  @IsOptional() @IsObject() profileDefaults?: Record<string, unknown>;
  @IsOptional() @IsArray() stageTemplates?: unknown[];
  @IsOptional() @IsObject() edgeCompatibility?: Record<string, unknown>;
  @IsOptional() @IsIn(['AI_PLANT_SETUP', 'MANUAL_EDIT']) changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export class UpdateProfileDraftDto {
  @IsInt() @Min(1) expectedRevision!: number;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsObject() profileConfig?: Record<string, unknown>;
}

export class ValidateProfileVersionDto {
  @IsInt() @Min(1) expectedRevision!: number;
}

export class UpdateGrowthStageDto {
  @IsInt() @Min(1) expectedRevision!: number;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsInt() @Min(1) sequence?: number;
  @IsOptional() @IsInt() @Min(0) minDurationDays?: number;
  @IsOptional() @IsInt() @Min(0) maxDurationDays?: number;
  @IsOptional() @IsObject() transitionCriteria?: Record<string, unknown>;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class CreateParameterDefinitionDto {
  @IsString() @MinLength(1) @MaxLength(64) parameterKey!: string;
  @IsString() @MinLength(1) @MaxLength(128) label!: string;
  @IsString() @MinLength(1) @MaxLength(16) dataType!: string;
  @IsOptional() @IsString() @MaxLength(64) unit?: string;
  @IsObject() valueSchema!: Record<string, unknown>;
  @IsOptional() @IsObject() metadataSchema?: Record<string, unknown>;
  @IsOptional() @IsIn(['AI_PLANT_SETUP', 'MANUAL_EDIT']) changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export class UpdateParameterDefinitionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) parameterKey?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) label?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(16) dataType?: string;
  @IsOptional() @IsString() @MaxLength(64) unit?: string | null;
  @IsOptional() @IsObject() valueSchema?: Record<string, unknown>;
  @IsOptional() @IsObject() metadataSchema?: Record<string, unknown>;
  @IsOptional() @IsIn(['AI_PLANT_SETUP', 'MANUAL_EDIT']) changeOrigin?: 'AI_PLANT_SETUP' | 'MANUAL_EDIT';
}

export class CreateGrowthStageDto {
  @IsString() code!: string;
  @IsString() label!: string;
  @IsInt() @Min(1) sequence!: number;
  @IsOptional() @IsInt() @Min(0) minDurationDays?: number;
  @IsOptional() @IsInt() @Min(0) maxDurationDays?: number;
  @IsOptional() @IsObject() transitionCriteria?: Record<string, unknown>;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class CreateDraftGrowthStageDto extends CreateGrowthStageDto {
  @IsInt() @Min(1) expectedRevision!: number;
}

export class CreatePlantProfileDto {
  @IsString() catalogVersionId!: string;
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsObject() profileConfig?: Record<string, unknown>;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateGrowthStageDto) stages!: CreateGrowthStageDto[];
}

export class AdoptPlantCatalogVersionDto {
  @IsString() catalogVersionId!: string;
}

export class ActivatePlantProfileDto {
  @IsString() organizationId!: string;
  @IsString() plantProfileVersionId!: string;
  @IsString() growthStageId!: string;
}

export class CreateZoneOverrideDto {
  @IsObject() overrideConfig!: Record<string, unknown>;
}

export class CreatePlatformGrantDto {
  @IsString() userId!: string;
}
