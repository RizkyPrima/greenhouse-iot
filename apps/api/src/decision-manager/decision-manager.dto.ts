import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateRuleSetDto {
  @IsObject()
  definition!: Record<string, unknown>;
}

export class DecisionFeedbackDto {
  @IsString()
  feedback!: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
