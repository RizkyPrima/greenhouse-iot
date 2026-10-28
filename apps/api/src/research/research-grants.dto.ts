import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateResearchSourceGrantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;

  @IsIn(['RESEARCH_SOURCE_ADMIN', 'SCIENTIFIC_EVIDENCE_CURATOR'])
  permission: 'RESEARCH_SOURCE_ADMIN' | 'SCIENTIFIC_EVIDENCE_CURATOR' = 'RESEARCH_SOURCE_ADMIN';
}
