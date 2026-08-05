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
