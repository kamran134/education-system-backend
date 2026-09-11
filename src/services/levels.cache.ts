import { pg } from "../config/pg";

/**
 * Старый кэш над таблицей levels (loadLevelsCache/getLevelsCache/getLevelByCode/getLevelByScore)
 * убран миграцией 026_drop_legacy_subject_columns.sql (IMTAHAN_NOVLERI_TASK.md §20.5) — сама
 * таблица levels снесена той же миграцией. getBands(scaleId) ниже — единственный источник правды
 * про pillə. Читатели старого кэша (common.service.ts, types/participation.types.ts,
 * controllers/reference.controller.ts, src/index.ts) переведены на бэнды.
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
let scaleCodeToId: Map<string, number> = new Map();

export async function loadLevelScaleBandsCache(): Promise<void> {
    const [rows, scaleRows] = await Promise.all([
        pg
            .selectFrom("level_scale_bands")
            .select(["scale_id", "code", "name_az", "rank", "participation_score", "min_percent", "max_percent"])
            .orderBy("scale_id", "asc")
            .orderBy("rank", "asc")
            .execute(),
        pg.selectFrom("level_scales").select(["id", "code"]).execute(),
    ]);

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

    scaleCodeToId = new Map(scaleRows.map((s) => [s.code, s.id]));
}

/** Бэнды одной шкалы pillə, отсортированные по rank. Пустой массив, если шкала не найдена. */
export function getBands(scaleId: number): LevelScaleBandRow[] {
    return bandsCache.get(scaleId) ?? [];
}

/**
 * Бэнды шкалы по её коду (например "isim_percent"), а не по id — нужно синхронным вызывающим,
 * у которых нет под рукой exam_type_id/scale_id (calculateLevel/calculateParticipationScore,
 * getLevelsReference — все три исторически работали с единственной, неявной шкалой). Пустой
 * массив, если код не найден.
 */
export function getBandsByScaleCode(scaleCode: string): LevelScaleBandRow[] {
    const scaleId = scaleCodeToId.get(scaleCode);
    return scaleId === undefined ? [] : getBands(scaleId);
}
