import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterResearchSourceDto {
  @IsOptional() @IsString() @MaxLength(255) doi?: string;
  @IsOptional() @IsString() @MaxLength(100) alternateIdentifierType?: string;
  @IsOptional() @IsString() @MaxLength(255) alternateIdentifier?: string;
  @IsOptional() @IsString() @MaxLength(255) crossrefId?: string;
  @IsOptional() @IsString() @MaxLength(255) openAlexId?: string;
  @IsString() @MinLength(1) @MaxLength(1000) title!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) authors?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1000) @Max(9999) publicationYear?: number;
  @IsOptional() @IsString() @MaxLength(500) journal?: string;
  @IsOptional() @IsString() @MaxLength(500) publisher?: string;
  @IsOptional() @IsString() @MaxLength(10000) abstract?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048) sourceUrl?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048) licenseUrl?: string;
  @IsOptional() @IsIn(['UNKNOWN', 'OPEN', 'RESTRICTED', 'CLOSED']) accessStatus?: 'UNKNOWN' | 'OPEN' | 'RESTRICTED' | 'CLOSED';
  @IsOptional() @IsIn(['UNKNOWN', 'OPEN_LICENSE', 'RESTRICTED_LICENSE', 'ALL_RIGHTS_RESERVED']) licenseStatus?: 'UNKNOWN' | 'OPEN_LICENSE' | 'RESTRICTED_LICENSE' | 'ALL_RIGHTS_RESERVED';
  @IsOptional() @IsIn(['UNKNOWN', 'OPEN_LICENSE', 'RESTRICTED_LICENSE', 'ALL_RIGHTS_RESERVED']) abstractLicenseStatus?: 'UNKNOWN' | 'OPEN_LICENSE' | 'RESTRICTED_LICENSE' | 'ALL_RIGHTS_RESERVED';
}

export class SearchResearchSourcesDto {
  @IsString() @MinLength(2) @MaxLength(200) query!: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @IsIn(['crossref', 'openalex'], { each: true }) providers?: Array<'crossref' | 'openalex'>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(25) limit = 10;
}

export class ResearchListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 25;
}
