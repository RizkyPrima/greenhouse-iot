import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'Greenhouse Owner' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ enum: ['create', 'join', 'none'], example: 'create' })
  @IsOptional()
  @IsString()
  organizationAction?: 'create' | 'join' | 'none';

  @ApiPropertyOptional({ example: 'My Smart Greenhouse' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  organizationName?: string;

  @ApiPropertyOptional({ example: 'my-smart-greenhouse' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(100)
  organizationSlug?: string;

  @ApiPropertyOptional({ example: 'INVITE-STANDARD-GREENHOUSE' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  joinCode?: string;

  @ApiPropertyOptional({ enum: UserRole, example: UserRole.VIEWER })
  @IsOptional()
  @IsEnum(UserRole)
  requestedRole?: UserRole;
}
