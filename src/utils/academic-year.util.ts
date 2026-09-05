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

/**
 * Разбор месячного фильтра "YYYY-MM" (тот же формат, что фронт шлёт для месячных вкладок
 * рейтингов, см. MONTHLY_RATINGS_TASK.md) в пару (year, month) для join'а на v_*_month_scores/
 * v_*_month_places (группировка там — по календарной паре, не по academic_year).
 *
 * null означает "нет месячного фильтра — работает прежний, годовой путь": пусто/undefined,
 * не соответствует формату, месяц вне 1-12, либо месяц равен 0 (так фронт кодирует "весь год"
 * на вкладках, где селект месяца уже есть).
 */
export function parseMonthFilter(month: string | undefined): { year: number; month: number } | null {
    if (!month) return null;
    const match = /^(\d{4})-(\d{1,2})$/.exec(month.trim());
    if (!match) return null;

    const year = parseInt(match[1], 10);
    const monthNum = parseInt(match[2], 10);
    if (monthNum === 0) return null;
    if (monthNum < 1 || monthNum > 12) return null;

    return { year, month: monthNum };
}
