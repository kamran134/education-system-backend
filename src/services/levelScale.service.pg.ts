import { sql } from "kysely";
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

/**
 * Максимальный ранг бэнда среди БОЛЕЕ РАННИХ результатов ОДНОГО И ТОГО ЖЕ ученика по ОДНОМУ И
 * ТОМУ ЖЕ типу экзамена в ОДНОМ И ТОМ ЖЕ учебном году. IMTAHAN_NOVLERI_TASK.md §15: критерий
 * повторяет markDevelopingStudents() (stats.service.pg.ts) буква в букву — та же пара условий
 * (сравнение только внутри exam_type_id + окно e.date >= 1 сентября academicYearStart,
 * e.date < beforeDate) — иначе импорт результатов и пересчёт "Reytinqləri yenilə" считали бы
 * development_score по-разному. Единственный источник истины для "прошлого максимума",
 * заменяет students.max_level (не различала тип экзамена, не учитывала учебный год — очки
 * разных типов смешивались, решение №6 §2 ТЗ).
 *
 * null — более ранних результатов этого типа в этом учебном году ещё не было (первый результат
 * года по этому типу никогда не считается развитием — так же, как в markDevelopingStudents).
 *
 * Только результаты, привязанные к реальному экзамену (exam_id NOT NULL, есть дата) — INNER JOIN
 * на exams исключает легаси-импорт без exam_id, тем же ограничением, что несёт markDevelopingStudents.
 */
export async function maxPriorBandRank(
    studentId: number,
    examTypeId: number,
    academicYearStart: number,
    beforeDate: Date
): Promise<number | null> {
    const row = await pg
        .selectFrom("student_results as sr2")
        .innerJoin("exams as e2", "e2.id", "sr2.exam_id")
        .innerJoin("level_scale_bands as b2", (join) =>
            join.onRef("b2.scale_id", "=", "sr2.level_scale_id").onRef("b2.code", "=", "sr2.level")
        )
        .select(() => [sql<number | null>`max(b2.rank)`.as("maxRank")])
        .where("sr2.student_id", "=", studentId)
        .where("sr2.exam_type_id", "=", examTypeId)
        .where("e2.date", "<", beforeDate)
        .where("e2.date", ">=", new Date(Date.UTC(academicYearStart, 8, 1)))
        .executeTakeFirst();
    return row?.maxRank != null ? Number(row.maxRank) : null;
}

export const levelScaleServicePg = new LevelScaleServicePg();
