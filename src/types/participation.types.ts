import { getBandsByScaleCode } from "../services/levels.cache";

export enum ParticipationLevel {
    E = 'E',
    D = 'D',
    C = 'C',
    B = 'B',
    A = 'A',
    Lisey = 'Lisey'
}

// Таблица levels снесена миграцией 026 (IMTAHAN_NOVLERI_TASK.md §20) — единственный живой
// (недостижимый) читатель этой функции, studentResult.service.ts (Mongo, мёртвый код),
// переведён на бэнды единственной шкалы isim_percent, тем же кодом E/D/C/B/A/Lisey, что был
// в старой levels.
function findBandByCode(code: string) {
    const bands = getBandsByScaleCode("isim_percent");
    return bands.find((b) => b.code.toUpperCase() === code);
}

export function calculateParticipationScore(level: string): number {
    const normalizedLevel = level.trim().toUpperCase();

    const exact = findBandByCode(normalizedLevel);
    if (exact) return exact.participationScore;

    // Check for Lisey variants
    if (normalizedLevel.includes('LISEY')) {
        return findBandByCode('LISEY')!.participationScore;
    }

    // Default to lowest score if level is not recognized
    return findBandByCode('E')!.participationScore;
}