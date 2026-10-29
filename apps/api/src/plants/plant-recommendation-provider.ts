export const PLANT_RECOMMENDATION_PROVIDER = 'PLANT_RECOMMENDATION_PROVIDER';

export interface PlantRecommendationGeneration {
  output: unknown;
  provider: { name: string; model: string };
}

export interface PlantRecommendationProvider {
  isConfigured(): boolean;
  getName(): string;
  getModel(): string | undefined;
  generateJson(input: unknown, outputSchema: Record<string, unknown>): Promise<unknown>;
  generateJsonWithMetadata(input: unknown, outputSchema: Record<string, unknown>): Promise<PlantRecommendationGeneration>;
}
