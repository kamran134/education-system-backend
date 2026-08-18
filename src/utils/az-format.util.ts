// Форматирование текста для сертификатов — азербайджанский, строго по вёрстке
// заказчика (CERTIFICATES_TASK.md §6.3).

// Месяц строчными, без года: «may ayında», не «May 2026».
export const AZ_MONTHS = [
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr",
];

export function azMonthName(month: number): string {
    const name = AZ_MONTHS[month - 1];
    if (!name) throw new Error(`Некорректный месяц: ${month}`);
    return name;
}

// Порядковые числительные 1..11 (диапазон классов). Суффикс зависит от гармонии
// гласных последнего слога корня — таблица, не формула, ошибиться было бы легко.
const ORDINAL_SUFFIX: Record<number, string> = {
    1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı",
    7: "ci", 8: "ci", 9: "cu", 10: "cu", 11: "ci",
};

export function azOrdinal(n: number): string {
    return `${n}-${ORDINAL_SUFFIX[n] ?? "ci"}`;
}

export function azDate(d: Date): string {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}.${mm}.${yyyy}`;
}
