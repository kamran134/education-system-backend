import { getLevelByCode } from "../services/levels.cache";

export enum ParticipationLevel {
    E = 'E',
    D = 'D',
    C = 'C',
    B = 'B',
    A = 'A',
    Lisey = 'Lisey'
}

export function calculateParticipationScore(level: string): number {
    const normalizedLevel = level.trim().toUpperCase();

    const exact = getLevelByCode(normalizedLevel);
    if (exact) return exact.participationScore;

    // Check for Lisey variants
    if (normalizedLevel.includes('LISEY')) {
        return getLevelByCode('Lisey')!.participationScore;
    }

    // Default to lowest score if level is not recognized
    return getLevelByCode('E')!.participationScore;
}