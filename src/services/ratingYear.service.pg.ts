import { pg } from "../config/pg";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

/**
 * REYTINQ_ILI_TASK.md — резолвер "за какой учебный год показывать баллы там, где год не
 * выбирают явно" (главные страницы, карточки сущностей, реестры). Явно выбранный год
 * (filters.academicYear, страница /stats) этот резолвер не трогает — вызывающий код обязан
 * сам решить, вызывать ли его (см. student.service.pg.ts::getFilteredStudents).
 */

const SETTING_KEY = "ratings.activated_academic_year";

/** Один флаг на все пять *_year_ratings — "Reytinqləri yenilə" считает их одним и тем же
 *  действием, расходиться по годам на разных страницах они не должны. */
const YEAR_RATING_TABLES = [
    "student_year_ratings",
    "teacher_year_ratings",
    "school_year_ratings",
    "district_year_ratings",
    "region_year_ratings",
] as const;

interface CacheEntry {
    value: number;
    expiresAt: number;
}

// Модульная переменная с TTL — на каждый запрос списка (teacher/school/district/region/student)
// иначе добавлялось бы по одному-двум лишним запросам в БД. Сбрасывается немедленно из
// setRatingYearActivated(), чтобы админ увидел эффект тумблера сразу, а не через минуту.
const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

async function getActivatedAcademicYear(): Promise<number | null> {
    const row = await pg.selectFrom("app_settings").select("value").where("key", "=", SETTING_KEY).executeTakeFirst();
    if (!row) return null;
    const value = row.value as { academicYear?: number } | null;
    return typeof value?.academicYear === "number" ? value.academicYear : null;
}

/** Наибольший год <= current, для которого есть хоть одна строка хоть в одной из пяти *_year_ratings. */
async function findLatestYearWithRatings(current: number): Promise<number | null> {
    const perTable = await Promise.all(
        YEAR_RATING_TABLES.map((table) =>
            pg
                .selectFrom(table)
                .select(({ fn }) => [fn.max("year" as any).as("max_year")])
                .where("year" as any, "<=", current)
                .executeTakeFirst()
        )
    );
    const years = perTable.map((r) => (r?.max_year as number | null) ?? null).filter((y): y is number => y !== null);
    if (years.length === 0) return null;
    return Math.max(...years);
}

/**
 * 1. current = getCurrentAcademicYear().
 * 2. Если admin активировал год >= current — значит новый год включён вручную, вернуть current.
 * 3. Иначе — последний год <= current, за который реально есть рейтинги хоть в одной таблице.
 * 4. Если рейтингов нет вообще — вернуть current (тогда нули честные, показывать нечего).
 */
export async function resolveRatingYear(): Promise<number> {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return cache.value;

    const current = getCurrentAcademicYear();
    const activated = await getActivatedAcademicYear();

    let result: number;
    if (activated !== null && activated >= current) {
        result = current;
    } else {
        const latest = await findLatestYearWithRatings(current);
        result = latest ?? current;
    }

    cache = { value: result, expiresAt: now + CACHE_TTL_MS };
    return result;
}

export async function getRatingYearState(): Promise<{ ratingYear: number; currentAcademicYear: number; activated: boolean }> {
    const currentAcademicYear = getCurrentAcademicYear();
    const activatedYear = await getActivatedAcademicYear();
    const ratingYear = await resolveRatingYear();
    return {
        ratingYear,
        currentAcademicYear,
        activated: activatedYear !== null && activatedYear >= currentAcademicYear,
    };
}

/**
 * true — upsert {"academicYear": currentAcademicYear}. false — удалить строку (а не записать
 * current - 1: отсутствие строки честнее читается в базе, чем "активирован прошлый год").
 */
export async function setRatingYearActivated(activated: boolean, userId: number): Promise<void> {
    if (activated) {
        const academicYear = getCurrentAcademicYear();
        await pg
            .insertInto("app_settings")
            .values({ key: SETTING_KEY, value: JSON.stringify({ academicYear }), updated_by: userId })
            .onConflict((oc) =>
                oc.column("key").doUpdateSet({ value: JSON.stringify({ academicYear }), updated_by: userId, updated_at: new Date() })
            )
            .execute();
    } else {
        await pg.deleteFrom("app_settings").where("key", "=", SETTING_KEY).execute();
    }
    cache = null;
}
