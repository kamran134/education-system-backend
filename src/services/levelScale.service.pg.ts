import { pg } from "../config/pg";

export interface LevelScaleBand {
    code: string;
    nameAz: string;
    rank: number;
    participationScore: number;
    minPercent: number;
    maxPercent: number;
}

export interface LevelScale {
    id: number;
    code: string;
    nameAz: string;
    note: string | null;
    active: boolean;
    bands: LevelScaleBand[];
}

/**
 * Шкалы pillə (IMTAHAN_NOVLERI_TASK.md §5) — процентные диапазоны E/D/C/B/A/Lisey,
 * хранящиеся в таблице, а не константой, чтобы проценты правились без миграции.
 */
export class LevelScaleServicePg {
    /** Все шкалы (включая неактивные — админ-просмотр) со своими бэндами, отсортированными по rank. */
    async findAll(): Promise<LevelScale[]> {
        const [scaleRows, bandRows] = await Promise.all([
            pg
                .selectFrom("level_scales")
                .select(["id", "code", "name_az", "note", "active"])
                .orderBy("id", "asc")
                .execute(),
            pg
                .selectFrom("level_scale_bands")
                .select(["scale_id", "code", "name_az", "rank", "participation_score", "min_percent", "max_percent"])
                .orderBy("rank", "asc")
                .execute(),
        ]);

        return scaleRows.map((s) => ({
            id: s.id,
            code: s.code,
            nameAz: s.name_az,
            note: s.note,
            active: s.active,
            bands: bandRows
                .filter((b) => b.scale_id === s.id)
                .map((b) => ({
                    code: b.code,
                    nameAz: b.name_az,
                    rank: b.rank,
                    participationScore: b.participation_score,
                    minPercent: Number(b.min_percent),
                    maxPercent: Number(b.max_percent),
                })),
        }));
    }

    async findById(id: number): Promise<LevelScale | null> {
        const all = await this.findAll();
        return all.find((s) => s.id === id) ?? null;
    }

    /**
     * Единственное место, где percent превращается в код бэнда — используется будущим
     * парсером Excel (шаг 2, не в этом шаге), но резолвер пишем сейчас, раз сервис заводится
     * сейчас (§5 ТЗ явно требует его в этом файле).
     * Полуинтервал [min_percent, max_percent), кроме верхнего бэнда, который включает 100
     * (см. комментарий к level_scale_bands в 023-й миграции).
     */
    async resolveBand(scaleId: number, percent: number): Promise<LevelScaleBand> {
        const scale = await this.findById(scaleId);
        const band = scale?.bands.find((b) => b.minPercent <= percent && percent < b.maxPercent);
        if (!band) {
            throw new Error(`Şkala (id=${scaleId}) üçün ${percent}% heç bir bənddə deyil`);
        }
        return band;
    }
}

export const levelScaleServicePg = new LevelScaleServicePg();
