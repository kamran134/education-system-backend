import { pg } from "../config/pg";

export interface LevelRow {
    code: string;
    nameAz: string;
    rank: number;
    participationScore: number;
    minTotalScore: number;
    maxTotalScore: number | null;
}

/**
 * Справочник levels — 6 строк, меняется практически никогда. Кэшируется в памяти при
 * старте вместо похода в БД на каждый calculateLevel/calculateParticipationScore.
 */
let cache: LevelRow[] = [];

export async function loadLevelsCache(): Promise<void> {
    const rows = await pg
        .selectFrom("levels")
        .select(["code", "name_az", "rank", "participation_score", "min_total_score", "max_total_score"])
        .where("active", "=", true)
        .orderBy("rank", "asc")
        .execute();

    cache = rows.map((r) => ({
        code: r.code,
        nameAz: r.name_az,
        rank: r.rank,
        participationScore: r.participation_score,
        minTotalScore: r.min_total_score,
        maxTotalScore: r.max_total_score,
    }));

    if (cache.length === 0) {
        throw new Error("levels cache пуст — таблица levels пуста или недоступна");
    }
}

export function getLevelsCache(): LevelRow[] {
    return cache;
}

export function getLevelByCode(code: string): LevelRow | undefined {
    const normalized = code.trim().toUpperCase();
    return cache.find((l) => l.code.toUpperCase() === normalized);
}

/** Уровень по total_score. Диапазоны берутся из levels; если ни один не подошёл — самый слабый (E). */
export function getLevelByScore(totalScore: number): LevelRow {
    const found = cache.find(
        (l) => totalScore >= l.minTotalScore && (l.maxTotalScore === null || totalScore <= l.maxTotalScore)
    );
    return found ?? cache[0];
}

/**
 * ВРЕМЕННОЕ сосуществование двух кэшей (IMTAHAN_NOVLERI_TASK.md §5, шаг 1). §5 ТЗ буквально
 * говорит "кэш становится по шкалам: getBands(scaleId)" — то есть переписать кэш выше целиком
 * под новую таблицу level_scale_bands. Это сломало бы компиляцию common.service.ts
 * (getLevelByScore) и types/participation.types.ts (getLevelByCode) — оба читают старую
 * таблицу levels и используются в stats.service.pg.ts, который в этом шаге трогать нельзя
 * (следующий шаг — миграция 026). Поэтому loadLevelsCache/getLevelsCache/getLevelByCode/
 * getLevelByScore и приватный cache выше остаются БЕЗ ИЗМЕНЕНИЙ, а ниже — отдельный кэш над
 * level_scale_bands. Когда stats.service.pg.ts и таблица levels будут выведены из
 * эксплуатации (миграция 026), getLevelByCode/getLevelByScore/cache удаляются, а getBands
 * остаётся единственным источником правды про pillə.
 */
export interface LevelScaleBandRow {
    scaleId: number;
    code: string;
    nameAz: string;
    rank: number;
    participationScore: number;
    minPercent: number;
    maxPercent: number;
}

let bandsCache: Map<number, LevelScaleBandRow[]> = new Map();

export async function loadLevelScaleBandsCache(): Promise<void> {
    const rows = await pg
        .selectFrom("level_scale_bands")
        .select(["scale_id", "code", "name_az", "rank", "participation_score", "min_percent", "max_percent"])
        .orderBy("scale_id", "asc")
        .orderBy("rank", "asc")
        .execute();

    const map = new Map<number, LevelScaleBandRow[]>();
    for (const r of rows) {
        const band: LevelScaleBandRow = {
            scaleId: r.scale_id,
            code: r.code,
            nameAz: r.name_az,
            rank: r.rank,
            participationScore: r.participation_score,
            minPercent: Number(r.min_percent),
            maxPercent: Number(r.max_percent),
        };
        const list = map.get(r.scale_id) ?? [];
        list.push(band);
        map.set(r.scale_id, list);
    }
    bandsCache = map;
}

/** Бэнды одной шкалы pillə, отсортированные по rank. Пустой массив, если шкала не найдена. */
export function getBands(scaleId: number): LevelScaleBandRow[] {
    return bandsCache.get(scaleId) ?? [];
}
