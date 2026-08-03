/**
 * Возвращает год начала текущего учебного года.
 * Учебный год: сентябрь–июнь
 * Пример: если сейчас февраль 2025 → учебный год 2024/2025 → вернёт 2024
 *          если сейчас октябрь 2025 → учебный год 2025/2026 → вернёт 2025
 */
export function getCurrentAcademicYear(): number {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1–12
    const currentYear = now.getFullYear();
    return currentMonth >= 9 ? currentYear : currentYear - 1;
}

/** Выпускной класс — при повышении на класс дальше не идут (в системе нет статуса "выпустился"). */
export const MAX_STUDENT_GRADE = 11;

/**
 * Окно, когда разрешено повышение класса на новый учебный год: июль-август —
 * единственные месяцы вне учебного года (сентябрь-июнь).
 */
export function isGradePromotionWindowOpen(now: Date = new Date()): boolean {
    const month = now.getMonth() + 1; // 1–12
    return month === 7 || month === 8;
}

/**
 * Учебный год, В КОТОРЫЙ повышаются ученики (год начала нового учебного года).
 * Действителен только внутри окна июль-август — вызывающий код должен сначала
 * проверить isGradePromotionWindowOpen().
 */
export function getPromotionTargetAcademicYear(now: Date = new Date()): number {
    return now.getFullYear();
}
