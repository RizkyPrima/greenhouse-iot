import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsString, IsUUID, MaxLength } from 'class-validator';

export class ApplyDevicePlantConfigurationDto {
  @IsUUID()
  configurationId!: string;

  @IsString()
  @MaxLength(100)
  catalogVersionId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  parameterKeys!: string[];
}
