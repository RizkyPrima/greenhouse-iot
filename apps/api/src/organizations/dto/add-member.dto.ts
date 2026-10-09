import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({ example: 'operator@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.VIEWER })
  @IsOptional()
  @IsEnum(UserRole)
  role: UserRole = UserRole.VIEWER;
}
