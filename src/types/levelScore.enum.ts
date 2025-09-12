// Mapping of education levels to base numeric scores.
// If level strings in DB differ (case/spacing), adjust normalization.
export enum LevelScore {
  E = 1,
  D = 2,
  C = 3,
  B = 4,
  A = 5,
  Lisey = 6,
}

// Helper to resolve score from raw level string stored in StudentResult.level
export function getLevelScore(level: string | undefined | null): number {
  if (!level) return 0; // or 0 if unknown
  const normalized = level.trim();
  switch (normalized) {
    case 'E': return LevelScore.E;
    case 'D': return LevelScore.D;
    case 'C': return LevelScore.C;
    case 'B': return LevelScore.B;
    case 'A': return LevelScore.A;
    case 'Lisey':
    case 'Lise':
    case 'Lisey ':
      return LevelScore.Lisey;
    default:
      return 0; // Unknown level
  }
}
