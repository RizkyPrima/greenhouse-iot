import { IsString, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ZoneStatus } from '@prisma/client';

export class CreateZoneDto {
  @ApiProperty({ example: 'uuid' })
  @IsString()
  greenhouseId: string;

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

  @ApiPropertyOptional({ enum: ZoneStatus })
  @IsOptional()
  @IsEnum(ZoneStatus)
  status?: ZoneStatus;
}
