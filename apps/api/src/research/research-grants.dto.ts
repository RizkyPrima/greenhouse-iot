import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateResearchSourceGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;
}
