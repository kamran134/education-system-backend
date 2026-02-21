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
