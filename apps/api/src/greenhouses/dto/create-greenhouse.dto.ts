import { IsString, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GreenhouseStatus } from '@prisma/client';

export class CreateGreenhouseDto {
  @ApiProperty({ example: 'uuid' })
  @IsString()
  organizationId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty()
  @IsString()
  timezone: string;

  @ApiPropertyOptional({ enum: GreenhouseStatus })
  @IsOptional()
  @IsEnum(GreenhouseStatus)
  status?: GreenhouseStatus;
}
