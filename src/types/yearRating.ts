/**
 * Статистика за конкретный учебный год.
 * year — год НАЧАЛА учебного года (например, 2024 = учебный год 2024/2025)
 */
export interface YearRating {
    year: number;
    score: number;
    averageScore: number;
    place: number | null;
}
