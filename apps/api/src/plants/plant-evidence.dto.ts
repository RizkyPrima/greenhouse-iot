import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

export class CreatePlantEvidenceDto {
  @IsObject()
  contract!: Record<string, unknown>;
}

export class ReviewPlantEvidenceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class CreatePlantProposalDto {
  @IsObject()
  contract!: Record<string, unknown>;
}

export class ReviewPlantProposalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
