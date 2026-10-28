export const PLANT_RECOMMENDATION_PROVIDER = 'PLANT_RECOMMENDATION_PROVIDER';

export interface PlantRecommendationProvider {
  isConfigured(): boolean;
  getName(): string;
  getModel(): string | undefined;
  generateJson(input: unknown, outputSchema: Record<string, unknown>): Promise<unknown>;
}
