export enum ParticipationLevel {
    E = 'E',
    D = 'D', 
    C = 'C',
    B = 'B',
    A = 'A',
    Lisey = 'Lisey'
}

export const ParticipationScoreMap: Record<ParticipationLevel, number> = {
    [ParticipationLevel.E]: 1,
    [ParticipationLevel.D]: 2,
    [ParticipationLevel.C]: 3,
    [ParticipationLevel.B]: 4,
    [ParticipationLevel.A]: 5,
    [ParticipationLevel.Lisey]: 6
};

export function calculateParticipationScore(level: string): number {
    const normalizedLevel = level.trim().toUpperCase();
    
    // Check for exact matches first
    for (const [key, value] of Object.entries(ParticipationScoreMap)) {
        if (key.toUpperCase() === normalizedLevel) {
            return value;
        }
    }
    
    // Check for Lisey variants
    if (normalizedLevel === 'LISEY' || normalizedLevel.includes('LISEY')) {
        return ParticipationScoreMap[ParticipationLevel.Lisey];
    }
    
    // Default to lowest score if level is not recognized
    return ParticipationScoreMap[ParticipationLevel.E];
}