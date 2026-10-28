import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const PLANT_CULTIVATION_METHODS = [
  'hydroponic_tower',
  'hydroponic_nft',
  'hydroponic_dwc',
  'soil',
  'other',
] as const;

export class GeneratePlantSetupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  commonName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  scientificName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cultivar?: string;

  @IsIn(PLANT_CULTIVATION_METHODS)
  cultivationMethod!: typeof PLANT_CULTIVATION_METHODS[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  growthStageContext?: string;
}
