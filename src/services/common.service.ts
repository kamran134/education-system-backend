import { getBandsByScaleCode } from "./levels.cache";

/**
 * ЛЕГАСИ, единственный живой (недостижимый) читатель — studentResult.service.ts (Mongo, мёртвый
 * код, IMTAHAN_NOVLERI_TASK.md §9/CLAUDE.md). До миграции 026 эти функции читали абсолютные
 * пороги total_score из таблицы levels (0..50, калибровка под 50-вопросный экзамен — см.
 * 001_levels_lookup.sql). Таблица levels снесена §20; переписано на бэнды единственной шкалы
 * isim_percent (023_exam_types_and_level_scales.sql), с тем же допущением "totalScore — это
 * баллы из 50", что было в старой таблице levels — приводим к проценту делением на 50. Это
 * задокументированное упрощение ради компилируемости мёртвого кода, а не починка: раз код
 * недостижим, точная процентная эквивалентность не имеет практического значения.
 */
const LEGACY_SCALE_CODE = "isim_percent";
const LEGACY_MAX_QUESTIONS = 50;

export const calculateLevel = (totalScore: number): string => {
    const bands = getBandsByScaleCode(LEGACY_SCALE_CODE);
    const percent = (totalScore / LEGACY_MAX_QUESTIONS) * 100;
    const found = bands.find((b) => percent >= b.minPercent && percent < b.maxPercent);
    return (found ?? bands[0])?.code ?? "E";
}

export const calculateLevelNumb = (totalScore: number): number => {
    const bands = getBandsByScaleCode(LEGACY_SCALE_CODE);
    const percent = (totalScore / LEGACY_MAX_QUESTIONS) * 100;
    const found = bands.find((b) => percent >= b.minPercent && percent < b.maxPercent);
    return (found ?? bands[0])?.rank ?? 1;
}
