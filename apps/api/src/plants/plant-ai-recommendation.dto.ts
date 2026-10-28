import { IsNotEmpty, IsString } from 'class-validator';

export class CreatePlantRecommendationDto {
  @IsString()
  @IsNotEmpty()
  profileVersionId!: string;

  @IsString()
  @IsNotEmpty()
  growthStageId!: string;
}
