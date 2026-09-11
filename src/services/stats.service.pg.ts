import { sql } from "kysely";
import { pg } from "../config/pg";
import { getCurrentAcademicYear, parseMonthFilter } from "../utils/academic-year.util";
import { FilterOptionsPg } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { escapeRegex } from "../utils/validation.util";
import { academicYearClosureServicePg } from "./academicYearClosure.service.pg";
import { resolveExamTypeId } from "./examType.service.pg";

export interface StatisticsFilterPg extends FilterOptionsPg {
    month?: string;
    sortColumn?: string;
    sortDirection?: string;
}

export interface StudentResultStatRow {
    id: number;
    examId: number | null;
    grade: number;
    totalScore: number;
    level: string;
    status: string | null;
    developmentScore: number | null;
    studentOfTheMonthScore: number | null;
    republicWideStudentOfTheMonthScore: number | null;
    month: number;
    year: number;
    studentData: {
        id: number; code: number; fullname: string;
        grade: number | null; averageScore: number | null; avatarUrl: string | null;
        teacher: { id: number; fullname: string } | null;
        school: { id: number; name: string } | null;
        district: { id: number; name: string } | null;
    };
    examData: { id: number; name: string; date: Date } | null;
}

export interface RankedEntity {
    id: number; code: number;
    score: number | null; averageScore: number | null; place: number | null; districtPlace: number | null;
    filterPlace: number | null;
    studentCount: number | null;
    districtCount?: number | null;
    name?: string;
    fullname?: string;
    school?: { id: number; name: string } | null;
    district?: { id: number; name: string } | null;
}

/**
 * Postgres-версия StatsService. Не перенесены (мёртвый код, проверено grep 04.08.2026 —
 * не вызываются ни из одного route/controller, только друг из друга): resetStats(), updateStatsOld().
 *
 * Главное упрощение по сравнению с Mongo-версией (91 КБ → на порядок меньше): пересчёт
 * score/averageScore/place/districtPlace для текущего года — это DELETE + INSERT из views
 * (v_*_year_scores, v_*_places), а не ручная JS-агрегация с bulkWrite. Ровно то, что обещано
 * в MONGO_TO_POSTGRES.md §1: "самый сложный код проекта становится самым простым".
 *
 * Путь расчёта мест для учителей/школ/районов — путь B (по среднему баллу), решение
 * пользователя 04.08.2026, см. db/rating-semantics.md и views в schema.sql.
 */
export class StatsServicePg {
    // ================================================================ WRITE-путь

    /**
     * Типы экзаменов, у которых есть результаты в этом учебном году — recompute* теперь
     * работает в разрезе (год, тип), иначе пересчёт одного типа стирал бы рейтинги остальных
     * (IMTAHAN_NOVLERI_TASK.md §5, шаг 3). В подавляющем большинстве случаев здесь ровно один
     * элемент (базовый тип) — цикл существует ради будущего, когда типов станет больше.
     */
    private async examTypeIdsWithResults(academicYear: number): Promise<number[]> {
        const rows = await pg
            .selectFrom("student_results")
            .select("exam_type_id")
            .distinct()
            .where("academic_year", "=", academicYear)
            .execute();
        return rows.map((r) => r.exam_type_id);
    }

    /** Пересчёт для текущего календарного месяца — вызывается после импорта результатов. */
    async updateStats(): Promise<number> {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const academicYear = getCurrentAcademicYear();
        await academicYearClosureServicePg.assertYearNotClosed(academicYear);

        const count = await pg
            .selectFrom("student_results")
            .select(({ fn }) => fn.countAll().as("c"))
            .where("month", "=", month)
            .where("year", "=", year)
            .executeTakeFirstOrThrow();

        if (Number(count.c) === 0) {
            for (const examTypeId of await this.examTypeIdsWithResults(academicYear)) {
                await this.recomputeStudentRatings(academicYear, examTypeId);
            }
            return 200;
        }

        await pg
            .updateTable("student_results")
            .set({ student_of_the_month_score: 0, republic_wide_student_of_the_month_score: 0 })
            .where("month", "=", month)
            .where("year", "=", year)
            .execute();

        await this.awardStudentOfTheMonth(month, year);
        await this.markDevelopingStudents(month, year);
        for (const examTypeId of await this.examTypeIdsWithResults(academicYear)) {
            await this.recomputeStudentRatings(academicYear, examTypeId);
        }

        return 200;
    }

    /** Полный пересчёт учебного года — сентябрь-июнь, плюс учителя/школы/районы. */
    async updateAllStats(): Promise<number> {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const academicYearStart = currentMonth >= 9 ? currentYear : currentYear - 1;
        const academicYearEnd = academicYearStart + 1;

        await academicYearClosureServicePg.assertYearNotClosed(academicYearStart);

        // Шаг 0: month/year результатов по факту даты экзамена (данные могли устареть после переноса
        // экзамена). Фильтр по незакрытым годам — починка бага, найденного при работе над §5 шага 3
        // (IMTAHAN_NOVLERI_TASK.md): assertYearNotClosed выше проверяет только ТЕКУЩИЙ учебный год,
        // поэтому без этого условия правка даты СТАРОГО экзамена (перенос задним числом) двигала
        // month/year строк уже закрытого года — а academic_year, будучи generated-колонкой от
        // (month, year), мог из-за этого вообще выкинуть результат из закрытого года. sr.academic_year
        // IS NULL (июль/август, вне какого-либо учебного года) — законно продолжает обновляться,
        // NOT IN с NULL в списке закрытых лет здесь не встаёт: сравнение с NULL слева отфильтровано
        // отдельным условием IS NULL, а не полагается на поведение NOT IN.
        await sql`
            UPDATE student_results sr
            SET month = EXTRACT(MONTH FROM e.date)::int, year = EXTRACT(YEAR FROM e.date)::int
            FROM exams e
            WHERE sr.exam_id = e.id
              AND (sr.month <> EXTRACT(MONTH FROM e.date)::int OR sr.year <> EXTRACT(YEAR FROM e.date)::int)
              AND (sr.academic_year IS NULL
                   OR sr.academic_year NOT IN (SELECT academic_year FROM academic_year_closures))
        `.execute(pg);

        // Шаг 1: обнуляем баллы месяца/развития за весь учебный год (сам score студента
        // обнулять вручную не нужно — он всегда пересчитывается заново из view в шаге 3).
        // status обнуляется вместе с development_score — иначе при повторном пересчёте
        // строка, которая в прошлый раз получила "İnkişaf edən şagird", но в этот раз
        // больше не проходит по markDevelopingStudents (база сравнения "макс. уровень
        // среди более ранних результатов" меняется по мере добавления новых месяцев),
        // осталась бы с development_score=0 и застрявшим текстом статуса навсегда.
        await pg
            .updateTable("student_results")
            .set({ development_score: 0, student_of_the_month_score: 0, republic_wide_student_of_the_month_score: 0, status: null })
            .where("academic_year", "=", academicYearStart)
            .execute();

        // Шаг 2: по каждому месяцу учебного года — награды "студент месяца" + "развивающийся студент"
        const academicMonths: Array<{ month: number; year: number }> = [
            { month: 9, year: academicYearStart }, { month: 10, year: academicYearStart },
            { month: 11, year: academicYearStart }, { month: 12, year: academicYearStart },
            { month: 1, year: academicYearEnd }, { month: 2, year: academicYearEnd },
            { month: 3, year: academicYearEnd }, { month: 4, year: academicYearEnd },
            { month: 5, year: academicYearEnd }, { month: 6, year: academicYearEnd },
        ];

        for (const { month, year } of academicMonths) {
            const count = await pg
                .selectFrom("student_results")
                .select(({ fn }) => fn.countAll().as("c"))
                .where("month", "=", month).where("year", "=", year)
                .executeTakeFirstOrThrow();
            if (Number(count.c) === 0) continue;

            await this.awardStudentOfTheMonth(month, year);
            await this.markDevelopingStudents(month, year);
        }

        // Шаг 3: пересчёт score/averageScore/place — студенты (путь A, единственный для них),
        // затем учителя/школы/районы/регионы (путь B). Порядок важен: регион читает
        // v_district_year_scores, поэтому recomputeRegionRatings идёт последним.
        // В разрезе (год, тип экзамена) — IMTAHAN_NOVLERI_TASK.md §5 шаг 3: пересчёт одного типа
        // не должен стирать рейтинги остальных, поэтому каждый recompute* вызывается по одному
        // типу за раз, а не одним DELETE+INSERT сразу по всем строкам года.
        for (const examTypeId of await this.examTypeIdsWithResults(academicYearStart)) {
            await this.recomputeStudentRatings(academicYearStart, examTypeId);
            await this.recomputeTeacherRatings(academicYearStart, examTypeId);
            await this.recomputeSchoolRatings(academicYearStart, examTypeId);
            await this.recomputeDistrictRatings(academicYearStart, examTypeId);
            await this.recomputeRegionRatings(academicYearStart, examTypeId);
        }

        return 200;
    }

    /**
     * Награждает "студента месяца" — по району (среди учеников того же класса, района И ТИПА
     * ЭКЗАМЕНА) и по республике (среди учеников того же класса и типа) — только если победитель
     * набрал бэнд с рангом не ниже exam_types.month_award_min_rank (NULL = условия нет вовсе).
     * Ученики без района не участвуют ни в одной из двух номинаций — так было и в Mongo-версии
     * (весь результат пропускался, если student.district пуст).
     *
     * IMTAHAN_NOVLERI_TASK.md §5 п.2: строковое сравнение upper(trim(level)) LIKE '%LISEY%'
     * убрано целиком — это был второй, менее надёжный источник истины про pillə (level читается
     * как текстовый код, сравнение "только Lisey" было зашито в SQL). Теперь ранг берётся из
     * level_scale_bands по (level_scale_id, level), сохранённым на самой строке результата, и
     * сравнивается с настраиваемым порогом типа экзамена — для базового типа порог (rank 6 =
     * Lisey) даёт то же самое поведение, что и раньше, но уже не хардкод.
     */
    private async awardStudentOfTheMonth(month: number, year: number): Promise<void> {
        await sql`
            WITH month_results AS (
                SELECT sr.id, sr.grade, sr.exam_type_id, s.district_id, sr.total_score,
                       b.rank AS band_rank, et.month_award_min_rank
                FROM student_results sr
                JOIN students s ON s.id = sr.student_id
                JOIN exam_types et ON et.id = sr.exam_type_id
                JOIN level_scale_bands b ON b.scale_id = sr.level_scale_id AND b.code = sr.level
                WHERE sr.month = ${month} AND sr.year = ${year} AND s.district_id IS NOT NULL
            ),
            max_district AS (
                SELECT exam_type_id, grade, district_id, MAX(total_score) AS max_score
                FROM month_results GROUP BY exam_type_id, grade, district_id
            )
            UPDATE student_results SET student_of_the_month_score = 5
            WHERE id IN (
                SELECT mr.id FROM month_results mr
                JOIN max_district md ON md.exam_type_id = mr.exam_type_id
                    AND md.grade = mr.grade AND md.district_id = mr.district_id AND md.max_score = mr.total_score
                WHERE mr.month_award_min_rank IS NULL OR mr.band_rank >= mr.month_award_min_rank
            )
        `.execute(pg);

        await sql`
            WITH month_results AS (
                SELECT sr.id, sr.grade, sr.exam_type_id, sr.total_score,
                       b.rank AS band_rank, et.month_award_min_rank
                FROM student_results sr
                JOIN students s ON s.id = sr.student_id
                JOIN exam_types et ON et.id = sr.exam_type_id
                JOIN level_scale_bands b ON b.scale_id = sr.level_scale_id AND b.code = sr.level
                WHERE sr.month = ${month} AND sr.year = ${year} AND s.district_id IS NOT NULL
            ),
            max_republic AS (
                SELECT exam_type_id, grade, MAX(total_score) AS max_score FROM month_results GROUP BY exam_type_id, grade
            )
            UPDATE student_results SET republic_wide_student_of_the_month_score = 5
            WHERE id IN (
                SELECT mr.id FROM month_results mr
                JOIN max_republic mrp ON mrp.exam_type_id = mr.exam_type_id
                    AND mrp.grade = mr.grade AND mrp.max_score = mr.total_score
                WHERE mr.month_award_min_rank IS NULL OR mr.band_rank >= mr.month_award_min_rank
            )
        `.execute(pg);
    }

    /**
     * +10 баллов и статус "İnkişaf edən şagird" тем, чей ранг бэнда pillə в этом месяце выше
     * максимального ранга из ВСЕХ их более ранних результатов ТОГО ЖЕ ТИПА ЭКЗАМЕНА в этом же
     * учебном году. Первый экзамен студента в году (по этому типу) никогда не считается
     * развитием (нет с чем сравнивать).
     *
     * IMTAHAN_NOVLERI_TASK.md §5 п.1: хардкод порогов total_score (CASE WHEN sr2.total_score
     * >= 47 THEN 6 ...) убран — это был второй источник истины про pillə, откалиброванный ровно
     * под экзамен на 50 вопросов и ломающийся на любом другом max_questions. Сравнение теперь
     * идёт по rank сохранённого на строке бэнда (level_scale_id, level), и только между
     * результатами ОДНОГО типа экзамена (sr2.exam_type_id = t.exam_type_id) — иначе развитие
     * могло бы "засчитаться" переходом от одного типа экзамена к другому с иной шкалой.
     */
    private async markDevelopingStudents(month: number, year: number): Promise<void> {
        const academicYearStart = month >= 9 ? year : year - 1;

        await sql`
            WITH target AS (
                SELECT sr.id, sr.student_id, sr.exam_type_id, e.date AS exam_date, b.rank AS band_rank
                FROM student_results sr
                JOIN exams e ON e.id = sr.exam_id
                JOIN level_scale_bands b ON b.scale_id = sr.level_scale_id AND b.code = sr.level
                WHERE sr.month = ${month} AND sr.year = ${year}
            ),
            prior_max AS (
                SELECT t.id, MAX(b2.rank) AS max_prev_rank
                FROM target t
                JOIN student_results sr2 ON sr2.student_id = t.student_id AND sr2.exam_type_id = t.exam_type_id
                JOIN exams e2 ON e2.id = sr2.exam_id
                JOIN level_scale_bands b2 ON b2.scale_id = sr2.level_scale_id AND b2.code = sr2.level
                WHERE e2.date < t.exam_date
                  AND e2.date >= make_date(${academicYearStart}, 9, 1)
                GROUP BY t.id
            )
            UPDATE student_results SET status = 'İnkişaf edən şagird', development_score = 10
            WHERE id IN (
                SELECT t.id FROM target t
                JOIN prior_max pm ON pm.id = t.id
                WHERE t.band_rank > pm.max_prev_rank
            )
        `.execute(pg);
    }

    /**
     * Полная замена строк текущего года — не ручной сброс+пересчёт, а DELETE+INSERT из view.
     * В разрезе (год, тип экзамена) — IMTAHAN_NOVLERI_TASK.md §5 шаг 3: после 025_ratings_by_exam_type.sql
     * PK каждой из пяти *_year_ratings — (сущность, год, exam_type_id), и DELETE/INSERT без
     * фильтра по типу задел бы (и тут же переписал) рейтинги ВСЕХ типов сразу, а не только того,
     * который сейчас пересчитывается — то есть код продолжал бы работать, но значение
     * "пересчитать один тип, не трогая остальные" было бы невозможно выразить.
     */
    private async recomputeStudentRatings(year: number, examTypeId: number): Promise<void> {
        await pg.deleteFrom("student_year_ratings").where("year", "=", year).where("exam_type_id", "=", examTypeId).execute();
        await sql`
            INSERT INTO student_year_ratings (student_id, year, exam_type_id, score, average_score, place, district_place)
            SELECT sc.student_id, sc.academic_year, sc.exam_type_id, sc.score, sc.average_score, p.place, p.district_place
            FROM v_student_year_scores sc
            LEFT JOIN v_student_places p ON p.student_id = sc.student_id AND p.academic_year = sc.academic_year AND p.exam_type_id = sc.exam_type_id
            WHERE sc.academic_year = ${year} AND sc.exam_type_id = ${examTypeId}
        `.execute(pg);
    }

    private async recomputeTeacherRatings(year: number, examTypeId: number): Promise<void> {
        await pg.deleteFrom("teacher_year_ratings").where("year", "=", year).where("exam_type_id", "=", examTypeId).execute();
        await sql`
            INSERT INTO teacher_year_ratings (teacher_id, year, exam_type_id, score, average_score, place, district_place)
            SELECT ts.teacher_id, ts.academic_year, ts.exam_type_id, ts.score, ts.average_score, p.place, p.district_place
            FROM v_teacher_year_scores ts
            LEFT JOIN v_teacher_places p ON p.teacher_id = ts.teacher_id AND p.academic_year = ts.academic_year AND p.exam_type_id = ts.exam_type_id
            WHERE ts.academic_year = ${year} AND ts.exam_type_id = ${examTypeId}
        `.execute(pg);
    }

    private async recomputeSchoolRatings(year: number, examTypeId: number): Promise<void> {
        await pg.deleteFrom("school_year_ratings").where("year", "=", year).where("exam_type_id", "=", examTypeId).execute();
        await sql`
            INSERT INTO school_year_ratings (school_id, year, exam_type_id, score, average_score, place, district_place)
            SELECT ss.school_id, ss.academic_year, ss.exam_type_id, ss.score, ss.average_score, p.place, p.district_place
            FROM v_school_year_scores ss
            LEFT JOIN v_school_places p ON p.school_id = ss.school_id AND p.academic_year = ss.academic_year AND p.exam_type_id = ss.exam_type_id
            WHERE ss.academic_year = ${year} AND ss.exam_type_id = ${examTypeId}
        `.execute(pg);
    }

    private async recomputeDistrictRatings(year: number, examTypeId: number): Promise<void> {
        await pg.deleteFrom("district_year_ratings").where("year", "=", year).where("exam_type_id", "=", examTypeId).execute();
        await sql`
            INSERT INTO district_year_ratings (district_id, year, exam_type_id, score, average_score, place)
            SELECT ds.district_id, ds.academic_year, ds.exam_type_id, ds.score, ds.average_score, p.place
            FROM v_district_year_scores ds
            LEFT JOIN v_district_places p ON p.district_id = ds.district_id AND p.academic_year = ds.academic_year AND p.exam_type_id = ds.exam_type_id
            WHERE ds.academic_year = ${year} AND ds.exam_type_id = ${examTypeId}
        `.execute(pg);
    }

    /** Регион читает v_district_year_scores — вызывать ПОСЛЕ recomputeDistrictRatings. */
    private async recomputeRegionRatings(year: number, examTypeId: number): Promise<void> {
        await pg.deleteFrom("region_year_ratings").where("year", "=", year).where("exam_type_id", "=", examTypeId).execute();
        await sql`
            INSERT INTO region_year_ratings (region_id, year, exam_type_id, score, average_score, place)
            SELECT rs.region_id, rs.academic_year, rs.exam_type_id, rs.score, rs.average_score, p.place
            FROM v_region_year_scores rs
            LEFT JOIN v_region_places p ON p.region_id = rs.region_id AND p.academic_year = rs.academic_year AND p.exam_type_id = rs.exam_type_id
            WHERE rs.academic_year = ${year} AND rs.exam_type_id = ${examTypeId}
        `.execute(pg);
    }

    // ================================================================ READ-путь: статистика/лидерборды
    //
    // Отдельные эндпоинты от обычных списков сущностей (district/school/teacher/student .service.pg.ts) —
    // это "страница статистики" фронтенда, читает те же данные, но со своей семантикой filterPlace
    // (ранг по сырому score в рамках текущего фильтра, не по averageScore) и, для районов, особым
    // поведением: place пересчитывается на лету под выбранную колонку сортировки (см. getDistrictStatistics).
    //
    // In-memory кэш (5 мин TTL) из Mongo-версии не перенесён — не влияет на корректность,
    // можно добавить отдельно как оптимизацию, когда появится нагрузка, которая её потребует.

    /**
     * IMTAHAN_NOVLERI_TASK.md §5 шаг 3: без явного examIds список экзаменов месяца теперь
     * сужается по типу (по умолчанию — базовый), иначе один календарный месяц смешал бы экзамены
     * разных типов в одну статистику — новый тип экзамена без этого молча искажал бы существующие
     * вкладки "Ayın şagirdləri"/"İnkişaf edən şagirdlər" сразу, как только у него появятся
     * результаты. Явный examIds (уже выбранный вызывающим набор экзаменов) типом не фильтруется —
     * он и так однозначен.
     */
    private async resolveExamIds(filters: StatisticsFilterPg): Promise<number[]> {
        if (filters.examIds && filters.examIds.length > 0) return filters.examIds;
        if (!filters.month) throw new Error("Month is required");
        const examTypeId = await resolveExamTypeId(filters.examTypeId);
        const { startDate, endDate } = RequestParser.parseMonthRange(filters.month);
        const rows = await pg
            .selectFrom("exams")
            .select("id")
            .where("date", ">=", startDate)
            .where("date", "<", endDate)
            .where("exam_type_id", "=", examTypeId)
            .execute();
        return rows.map((r) => r.id);
    }

    private async queryStudentResultStats(filters: StatisticsFilterPg, examIds: number[]): Promise<StudentResultStatRow[]> {
        let query = pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .leftJoin("teachers as t", "t.id", "st.teacher_id")
            .leftJoin("schools as sc", "sc.id", "st.school_id")
            .leftJoin("districts as d", "d.id", "st.district_id")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            // syr.year = sr.academic_year (не всегда currentYear!) — строки student_year_ratings
            // это результаты КОНКРЕТНОГО месяца, возможно прошлогоднего: месячные вкладки статистики
            // показывают историю, а не только текущий учебный год. Раньше join был на currentYear —
            // из-за этого в сентябре 2026 "Orta reytinq xalı" на всех прошлых месяцах был пустым
            // (SINIF_TARIXCESI_TASK.md §2.6). sr.academic_year — generated-колонка student_results.
            // exam_type_id в джойне — после 025_ratings_by_exam_type.sql PK student_year_ratings
            // включает тип экзамена, у ученика может быть по строке на каждый тип за год; матчим
            // ровно на тип ЭТОГО результата (sr.exam_type_id), иначе join размножил бы строки.
            .leftJoin("student_year_ratings as syr", (join) =>
                join.onRef("syr.student_id", "=", "st.id")
                    .onRef("syr.year", "=", "sr.academic_year")
                    .onRef("syr.exam_type_id", "=", "sr.exam_type_id")
            )
            // levels снесена миграцией 026 (IMTAHAN_NOVLERI_TASK.md §20) — level_scale_bands,
            // композитный джойн по (scale_id, code), тем же критерием, что и student_results
            // FK level_band_fkey (024) и maxPriorBandRank (levelScale.service.pg.ts, §15).
            .leftJoin("level_scale_bands as lvl", (join) =>
                join.onRef("lvl.scale_id", "=", "sr.level_scale_id").onRef("lvl.code", "=", "sr.level")
            )
            .where("sr.exam_id", "in", examIds)
            .select([
                "sr.id as id", "sr.exam_id as exam_id", "sr.grade as grade", "sr.total_score as total_score",
                "sr.level as level", "sr.status as status", "sr.development_score as development_score",
                "sr.student_of_the_month_score as student_of_the_month_score",
                "sr.republic_wide_student_of_the_month_score as republic_wide_student_of_the_month_score",
                "sr.month as month", "sr.year as year",
                // Рейтинговый балл ЭТОГО результата — те же четыре слагаемых, из которых
                // v_student_year_scores складывает годовой рейтинг. Колонка sr.score для этого
                // не годится: у каждого результата она жёстко равна 1 («одно участие»,
                // studentResult.service.pg.ts), и колонка «Reytinq xalı» на месячных вкладках
                // из-за этого не показывала ничего осмысленного.
                sql<number>`coalesce(sr.participation_score, 0) + coalesce(sr.development_score, 0)
                    + coalesce(sr.student_of_the_month_score, 0)
                    + coalesce(sr.republic_wide_student_of_the_month_score, 0)`.as("rating_score"),
                "st.id as student_id", "st.code as student_code", "st.fullname as student_fullname",
                "st.grade as student_grade",
                "st.avatar_url as student_avatar_url",
                "syr.average_score as student_average_score",
                "t.id as teacher_id", "t.fullname as teacher_fullname",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as district_id", "d.name as district_name",
                "e.id as e_id", "e.name as e_name", "e.date as e_date",
            ]);

        if (filters.regionIds && filters.regionIds.length > 0) {
            query = query.where("d.region_id", "in", filters.regionIds);
        }
        if (filters.districtIds && filters.districtIds.length > 0) {
            query = query.where("st.district_id", "in", filters.districtIds);
        }
        if (filters.schoolIds && filters.schoolIds.length > 0) {
            query = query.where("st.school_id", "in", filters.schoolIds);
        }
        if (filters.teacherIds && filters.teacherIds.length > 0) {
            query = query.where("st.teacher_id", "in", filters.teacherIds);
        }
        if (filters.studentIds && filters.studentIds.length > 0) {
            query = query.where("st.id", "in", filters.studentIds);
        }
        if (filters.grades && filters.grades.length > 0) {
            query = query.where("sr.grade", "in", filters.grades);
        }
        if (filters.levels && filters.levels.length > 0) {
            query = query.where("sr.level", "in", filters.levels);
        }
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 10);
            query = query.where("st.code", ">=", parseInt(start)).where("st.code", "<=", parseInt(end));
        }

        if (filters.sortColumn && filters.sortDirection) {
            const dir = filters.sortDirection === "asc" ? "asc" : "desc";
            const columnMap: Record<string, any> = {
                // Порядок силы уровня — из level_scale_bands.rank (E=1..Lisey=6), а не из хардкода.
                level: sql`lvl.rank`,
                code: sql`st.code`, fullname: sql`st.fullname COLLATE az_ci`,
                // sr.grade (класс на момент результата), не st.grade (живой) — сортировка должна
                // идти по тому же классу, который показан в колонке (см. r.grade в маппинге ниже).
                grade: sql`sr.grade`,
                teacher: sql`t.fullname COLLATE az_ci`, school: sql`sc.name COLLATE az_ci`, district: sql`d.name COLLATE az_ci`,
                totalScore: sql`sr.total_score`, averageScore: sql`syr.average_score`,
                score: sql`coalesce(sr.participation_score, 0) + coalesce(sr.development_score, 0)
                    + coalesce(sr.student_of_the_month_score, 0)
                    + coalesce(sr.republic_wide_student_of_the_month_score, 0)`,
            };
            const orderExpr = columnMap[filters.sortColumn] ?? sql.ref(filters.sortColumn);
            const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;
            query = query.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`) as typeof query;
        }

        const rows = await query.execute();

        return rows.map((r: any) => ({
            id: r.id, examId: r.exam_id, grade: r.grade, totalScore: r.total_score, level: r.level, status: r.status,
            developmentScore: r.development_score, studentOfTheMonthScore: r.student_of_the_month_score,
            republicWideStudentOfTheMonthScore: r.republic_wide_student_of_the_month_score,
            month: r.month, year: r.year, score: Number(r.rating_score ?? 0),
            studentData: {
                id: r.student_id, code: r.student_code, fullname: r.student_fullname,
                grade: r.student_grade, averageScore: r.student_average_score,
                avatarUrl: r.student_avatar_url,
                teacher: r.teacher_id ? { id: r.teacher_id, fullname: r.teacher_fullname } : null,
                school: r.school_id ? { id: r.school_id, name: r.school_name } : null,
                district: r.district_id ? { id: r.district_id, name: r.district_name } : null,
            },
            examData: r.e_id ? { id: r.e_id, name: r.e_name, date: r.e_date } : null,
        }));
    }

    async getStudentStatistics(filters: StatisticsFilterPg): Promise<{
        studentsOfMonth: StudentResultStatRow[];
        studentsOfMonthByRepublic: StudentResultStatRow[];
        developingStudents: StudentResultStatRow[];
    }> {
        const examIds = await this.resolveExamIds(filters);
        if (examIds.length === 0) throw new Error("No exams found for the specified month");

        const rows = await this.queryStudentResultStats(filters, examIds);
        return {
            studentsOfMonth: rows.filter((r) => (r.studentOfTheMonthScore ?? 0) > 0),
            studentsOfMonthByRepublic: rows.filter((r) => (r.republicWideStudentOfTheMonthScore ?? 0) > 0),
            developingStudents: rows.filter((r) => (r.developmentScore ?? 0) > 0),
        };
    }

    async getDevelopingStudents(filters: StatisticsFilterPg): Promise<StudentResultStatRow[]> {
        const examIds = await this.resolveExamIds(filters);
        if (examIds.length === 0) throw new Error("No exams found for the specified month");
        const rows = await this.queryStudentResultStats(filters, examIds);
        return rows.filter((r) => (r.developmentScore ?? 0) > 0);
    }

    async getStudentsOfMonth(filters: StatisticsFilterPg): Promise<StudentResultStatRow[]> {
        const examIds = await this.resolveExamIds(filters);
        if (examIds.length === 0) throw new Error("No exams found for the specified month");
        const rows = await this.queryStudentResultStats(filters, examIds);
        return rows.filter((r) => (r.studentOfTheMonthScore ?? 0) > 0);
    }

    async getStudentsOfMonthByRepublic(filters: StatisticsFilterPg): Promise<StudentResultStatRow[]> {
        const examIds = await this.resolveExamIds(filters);
        if (examIds.length === 0) throw new Error("No exams found for the specified month");
        const rows = await this.queryStudentResultStats(filters, examIds);
        return rows.filter((r) => (r.republicWideStudentOfTheMonthScore ?? 0) > 0);
    }

    async getStatisticsByExam(examId: number): Promise<{
        studentsOfMonth: StudentResultStatRow[];
        studentsOfMonthByRepublic: StudentResultStatRow[];
        developingStudents: StudentResultStatRow[];
    }> {
        const rows = await this.queryStudentResultStats({}, [examId]);
        return {
            studentsOfMonth: rows.filter((r) => (r.studentOfTheMonthScore ?? 0) > 0),
            studentsOfMonthByRepublic: rows.filter((r) => (r.republicWideStudentOfTheMonthScore ?? 0) > 0),
            developingStudents: rows.filter((r) => (r.developmentScore ?? 0) > 0),
        };
    }

    /** filterPlace: dense rank по сырому score (не averageScore) в рамках уже применённого фильтра. */
    /**
     * Ручной фильтр «по региону» в UI /stats (не путать с role-скоупингом regionRepresenter,
     * который уже приходит как districtIds — см. utils/region-scope.util.ts). Разворачивает
     * regionIds в districtIds один раз на запрос, дальше используется как обычный массив,
     * без Kysely-подзапросов — так делают остальные фильтры в этом файле.
     */
    private async resolveRegionDistrictIds(regionIds: number[] | undefined): Promise<number[] | null> {
        if (!regionIds || regionIds.length === 0) return null;
        const rows = await pg.selectFrom("districts").select("id").where("region_id", "in", regionIds).execute();
        return rows.map((r) => r.id);
    }

    async getTeacherStatistics(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const currentYear = filters.academicYear ?? getCurrentAcademicYear();
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";
        const regionDistrictIds = await this.resolveRegionDistrictIds(filters.regionIds);
        // IMTAHAN_NOVLERI_TASK.md §5 шаг 3: без examTypeId — базовый тип, существующие экраны
        // не передают параметр вовсе и обязаны видеть ровно то же, что и до появления типов.
        const examTypeId = await resolveExamTypeId(filters.examTypeId);

        // Месячный режим (п.10 ТЗ 04.09.2026, MONTHLY_RATINGS_TASK.md) — отдельная ветка, а не
        // общий билдер с условными выражениями: годовой путь ниже должен остаться нетронутым.
        const monthFilter = parseMonthFilter(filters.month);
        if (monthFilter) {
            return this.getTeacherStatisticsByMonth(filters, sortColumn, sortDirection, monthFilter, regionDistrictIds, examTypeId);
        }

        const baseQuery = () => {
            let q = pg
                .selectFrom("teachers as t")
                .leftJoin("teacher_year_ratings as tyr", (join) =>
                    join.onRef("tyr.teacher_id", "=", "t.id").on("tyr.year", "=", currentYear).on("tyr.exam_type_id", "=", examTypeId)
                );
            if (filters.teacherIds && filters.teacherIds.length > 0) {
                q = q.where("t.id", "in", filters.teacherIds);
            } else {
                q = q.where("t.active", "=", true);
                if (filters.districtIds && filters.districtIds.length > 0) q = q.where("t.district_id", "in", filters.districtIds);
                if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("t.school_id", "in", filters.schoolIds);
                if (regionDistrictIds) q = q.where("t.district_id", "in", regionDistrictIds);
            }
            return q;
        };

        const isSelfView = !!(filters.teacherIds && filters.teacherIds.length > 0);
        // filterPlace: dense rank by score within this exact filtered scope (same WHERE as baseQuery,
        // no separate query needed — the scope here already equals the result scope, unlike students
        // where code/search must be excluded from the rank; see getFilteredStudents).
        const filterPlaceExpr = sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(tyr.score, 0) DESC)`;
        const sortMap: Record<string, any> = {
            score: sql`tyr.score`, averageScore: sql`tyr.average_score`, place: sql`tyr.place`,
            districtPlace: sql`tyr.district_place`, code: sql`t.code`,
            // "fullName" (capital N) is the persisted frontend column key; "fullname" kept for back-compat.
            fullname: sql`t.fullname COLLATE az_ci`, fullName: sql`t.fullname COLLATE az_ci`,
            school: sql`sc.name COLLATE az_ci`, district: sql`d.name COLLATE az_ci`, studentCount: sql`t.student_count`,
            filterPlace: sql`filter_place`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`tyr.average_score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;

        let rowsQuery = baseQuery()
            .leftJoin("schools as sc", "sc.id", "t.school_id")
            .leftJoin("districts as d", "d.id", "t.district_id")
            .select([
                "t.id as id", "t.code as code", "t.fullname as fullname", "t.student_count as student_count",
                "tyr.score as score", "tyr.average_score as average_score", "tyr.place as place", "tyr.district_place as district_place",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as teacher_district_id", "d.name as teacher_district_name",
            ])
            .select(filterPlaceExpr.as("filter_place"));
        if (!isSelfView) {
            // NULLS LAST: учителя без строки в teacher_year_ratings иначе всплывают в начало при DESC.
            rowsQuery = rowsQuery.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip) as typeof rowsQuery;
        }
        const [rows, countRow] = await Promise.all([
            rowsQuery.execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, fullname: r.fullname, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: r.place, districtPlace: r.district_place, studentCount: r.student_count ?? 0,
            filterPlace: r.filter_place ?? null,
            school: r.school_id ? { id: r.school_id, name: r.school_name! } : null,
            district: r.teacher_district_id ? { id: r.teacher_district_id, name: r.teacher_district_name! } : null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Месячный срез для учителей — параллель getTeacherStatistics, но читает
     * v_teacher_month_scores/v_teacher_month_places вместо teacher_year_ratings. average_score
     * колонки в месячном срезе нет вовсе (см. шапку 021_monthly_rating_views.sql) — averageScore
     * в ответе всегда null, а не 0: 0 фронт нарисовал бы как настоящий ноль.
     */
    private async getTeacherStatisticsByMonth(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string,
        monthFilter: { year: number; month: number },
        regionDistrictIds: number[] | null,
        examTypeId: number
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";

        const baseQuery = () => {
            let q = pg
                .selectFrom("teachers as t")
                .leftJoin("v_teacher_month_scores as tms", (join) =>
                    join.onRef("tms.teacher_id", "=", "t.id").on("tms.year", "=", monthFilter.year)
                        .on("tms.month", "=", monthFilter.month).on("tms.exam_type_id", "=", examTypeId)
                );
            if (filters.teacherIds && filters.teacherIds.length > 0) {
                q = q.where("t.id", "in", filters.teacherIds);
            } else {
                q = q.where("t.active", "=", true);
                if (filters.districtIds && filters.districtIds.length > 0) q = q.where("t.district_id", "in", filters.districtIds);
                if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("t.school_id", "in", filters.schoolIds);
                if (regionDistrictIds) q = q.where("t.district_id", "in", regionDistrictIds);
            }
            return q;
        };

        const isSelfView = !!(filters.teacherIds && filters.teacherIds.length > 0);
        const filterPlaceExpr = sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(tms.score, 0) DESC)`;
        const sortMap: Record<string, any> = {
            score: sql`tms.score`,
            // averageScore не существует в месячном срезе — подменяем на score, а не роняем запрос.
            averageScore: sql`tms.score`,
            place: sql`tmp.place`, districtPlace: sql`tmp.district_place`, code: sql`t.code`,
            fullname: sql`t.fullname COLLATE az_ci`, fullName: sql`t.fullname COLLATE az_ci`,
            school: sql`sc.name COLLATE az_ci`, district: sql`d.name COLLATE az_ci`, studentCount: sql`t.student_count`,
            filterPlace: sql`filter_place`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`tms.score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;

        let rowsQuery = baseQuery()
            .leftJoin("v_teacher_month_places as tmp", (join) =>
                join.onRef("tmp.teacher_id", "=", "t.id").on("tmp.year", "=", monthFilter.year)
                    .on("tmp.month", "=", monthFilter.month).on("tmp.exam_type_id", "=", examTypeId)
            )
            .leftJoin("schools as sc", "sc.id", "t.school_id")
            .leftJoin("districts as d", "d.id", "t.district_id")
            .select([
                "t.id as id", "t.code as code", "t.fullname as fullname", "t.student_count as student_count",
                "tms.score as score", "tmp.place as place", "tmp.district_place as district_place",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as teacher_district_id", "d.name as teacher_district_name",
            ])
            .select(filterPlaceExpr.as("filter_place"));
        if (!isSelfView) {
            // NULLS LAST: учителя без результатов в этом месяце иначе всплывают в начало при DESC.
            rowsQuery = rowsQuery.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip) as typeof rowsQuery;
        }
        const [rows, countRow] = await Promise.all([
            rowsQuery.execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, fullname: r.fullname, score: r.score ?? 0, averageScore: null,
            place: r.place, districtPlace: r.district_place, studentCount: r.student_count ?? 0,
            filterPlace: r.filter_place ?? null,
            school: r.school_id ? { id: r.school_id, name: r.school_name! } : null,
            district: r.teacher_district_id ? { id: r.teacher_district_id, name: r.teacher_district_name! } : null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    async getSchoolStatistics(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const currentYear = filters.academicYear ?? getCurrentAcademicYear();
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";
        const regionDistrictIds = await this.resolveRegionDistrictIds(filters.regionIds);
        const examTypeId = await resolveExamTypeId(filters.examTypeId);

        // Месячный режим — отдельная ветка, см. комментарий в getTeacherStatistics.
        const monthFilter = parseMonthFilter(filters.month);
        if (monthFilter) {
            return this.getSchoolStatisticsByMonth(filters, sortColumn, sortDirection, monthFilter, regionDistrictIds, examTypeId);
        }

        const baseQuery = () => {
            let q = pg
                .selectFrom("schools as sc")
                .leftJoin("school_year_ratings as syr", (join) =>
                    join.onRef("syr.school_id", "=", "sc.id").on("syr.year", "=", currentYear).on("syr.exam_type_id", "=", examTypeId)
                )
                .where("sc.active", "=", true);
            if (filters.districtIds && filters.districtIds.length > 0) q = q.where("sc.district_id", "in", filters.districtIds);
            if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("sc.id", "in", filters.schoolIds);
            if (regionDistrictIds) q = q.where("sc.district_id", "in", regionDistrictIds);
            return q;
        };

        // filterPlace: dense rank by score within this exact filtered scope — same reasoning as
        // getTeacherStatistics above.
        const filterPlaceExpr = sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(syr.score, 0) DESC)`;
        const sortMap: Record<string, any> = {
            score: sql`syr.score`, averageScore: sql`syr.average_score`, place: sql`syr.place`,
            districtPlace: sql`syr.district_place`, code: sql`sc.code`, name: sql`sc.name COLLATE az_ci`,
            district: sql`d.name COLLATE az_ci`, studentCount: sql`sc.student_count`, filterPlace: sql`filter_place`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`syr.average_score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;

        const [rows, countRow] = await Promise.all([
            baseQuery()
                .leftJoin("districts as d", "d.id", "sc.district_id")
                .select([
                    "sc.id as id", "sc.code as code", "sc.name as name", "sc.student_count as student_count",
                    "syr.score as score", "syr.average_score as average_score", "syr.place as place", "syr.district_place as district_place",
                    "d.id as school_district_id", "d.name as school_district_name",
                ])
                .select(filterPlaceExpr.as("filter_place"))
                // NULLS LAST: школы без строки в school_year_ratings иначе всплывают в начало при DESC.
                .orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip).execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, name: r.name, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: r.place, districtPlace: r.district_place, studentCount: r.student_count ?? 0,
            filterPlace: r.filter_place ?? null,
            district: r.school_district_id ? { id: r.school_district_id, name: r.school_district_name! } : null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Месячный срез для школ — параллель getSchoolStatistics, читает v_school_month_scores/
     * v_school_month_places. averageScore — всегда null, см. комментарий в
     * getTeacherStatisticsByMonth.
     */
    private async getSchoolStatisticsByMonth(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string,
        monthFilter: { year: number; month: number },
        regionDistrictIds: number[] | null,
        examTypeId: number
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";

        const baseQuery = () => {
            let q = pg
                .selectFrom("schools as sc")
                .leftJoin("v_school_month_scores as sms", (join) =>
                    join.onRef("sms.school_id", "=", "sc.id").on("sms.year", "=", monthFilter.year)
                        .on("sms.month", "=", monthFilter.month).on("sms.exam_type_id", "=", examTypeId)
                )
                .where("sc.active", "=", true);
            if (filters.districtIds && filters.districtIds.length > 0) q = q.where("sc.district_id", "in", filters.districtIds);
            if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("sc.id", "in", filters.schoolIds);
            if (regionDistrictIds) q = q.where("sc.district_id", "in", regionDistrictIds);
            return q;
        };

        const filterPlaceExpr = sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(sms.score, 0) DESC)`;
        const sortMap: Record<string, any> = {
            score: sql`sms.score`,
            // averageScore не существует в месячном срезе — подменяем на score.
            averageScore: sql`sms.score`,
            place: sql`smp.place`, districtPlace: sql`smp.district_place`, code: sql`sc.code`, name: sql`sc.name COLLATE az_ci`,
            district: sql`d.name COLLATE az_ci`, studentCount: sql`sc.student_count`, filterPlace: sql`filter_place`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`sms.score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;

        const [rows, countRow] = await Promise.all([
            baseQuery()
                .leftJoin("v_school_month_places as smp", (join) =>
                    join.onRef("smp.school_id", "=", "sc.id").on("smp.year", "=", monthFilter.year)
                        .on("smp.month", "=", monthFilter.month).on("smp.exam_type_id", "=", examTypeId)
                )
                .leftJoin("districts as d", "d.id", "sc.district_id")
                .select([
                    "sc.id as id", "sc.code as code", "sc.name as name", "sc.student_count as student_count",
                    "sms.score as score", "smp.place as place", "smp.district_place as district_place",
                    "d.id as school_district_id", "d.name as school_district_name",
                ])
                .select(filterPlaceExpr.as("filter_place"))
                // NULLS LAST: школы без результатов в этом месяце иначе всплывают в начало при DESC.
                .orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip).execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, name: r.name, score: r.score ?? 0, averageScore: null,
            place: r.place, districtPlace: r.district_place, studentCount: r.student_count ?? 0,
            filterPlace: r.filter_place ?? null,
            district: r.school_district_id ? { id: r.school_district_id, name: r.school_district_name! } : null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Регион (PHASE3 п.1б) — по образцу getSchoolStatistics, НЕ getDistrictStatistics: у региона
     * place берётся из region_year_ratings (записанного пересчётом), место не пересчитывается на
     * лету под колонку сортировки — легаси-поведение района воспроизводить здесь незачем.
     * studentCount — живой count(), у региона нет денормализованной колонки (см. db/schema.sql).
     */
    async getRegionStatistics(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const currentYear = filters.academicYear ?? getCurrentAcademicYear();
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";
        const examTypeId = await resolveExamTypeId(filters.examTypeId);

        // Месячный режим — отдельная ветка, см. комментарий в getTeacherStatistics.
        const monthFilter = parseMonthFilter(filters.month);
        if (monthFilter) {
            return this.getRegionStatisticsByMonth(filters, sortColumn, sortDirection, monthFilter, examTypeId);
        }

        const baseQuery = () => {
            let q = pg
                .selectFrom("regions as r")
                .leftJoin("region_year_ratings as ryr", (join) =>
                    join.onRef("ryr.region_id", "=", "r.id").on("ryr.year", "=", currentYear).on("ryr.exam_type_id", "=", examTypeId)
                )
                .where("r.active", "=", true);
            if (filters.regionIds && filters.regionIds.length > 0) q = q.where("r.id", "in", filters.regionIds);
            return q;
        };

        // filterPlace: dense rank by score within this exact filtered scope — same reasoning as
        // getTeacherStatistics above.
        const filterPlaceExpr = sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(ryr.score, 0) DESC)`;
        const sortMap: Record<string, any> = {
            score: sql`ryr.score`, averageScore: sql`ryr.average_score`, place: sql`ryr.place`,
            code: sql`r.code`, name: sql`r.name COLLATE az_ci`,
            // References the `student_count`/`district_count`/`filter_place` SELECT aliases below —
            // no table prefix, same technique as participation_count in student.service.pg.ts.
            studentCount: sql`student_count`, districtCount: sql`district_count`, filterPlace: sql`filter_place`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`ryr.average_score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;
        const studentCountExpr = sql<number>`(SELECT count(*) FROM students st JOIN districts d ON d.id = st.district_id WHERE d.region_id = r.id)`;
        // Same count region.service.pg.ts's attachExtras() does for the plain regions list —
        // "Rayon sayı" was in the API response for the list, but never for this ranking query.
        const districtCountExpr = sql<number>`(SELECT count(*) FROM districts dd WHERE dd.region_id = r.id)`;

        const [rows, countRow] = await Promise.all([
            baseQuery()
                .select(["r.id as id", "r.code as code", "r.name as name", "ryr.score as score", "ryr.average_score as average_score", "ryr.place as place"])
                .select(studentCountExpr.as("student_count"))
                .select(districtCountExpr.as("district_count"))
                .select(filterPlaceExpr.as("filter_place"))
                // NULLS LAST: регионы без строки в region_year_ratings иначе всплывают в начало при DESC.
                .orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip).execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, name: r.name, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: r.place, districtPlace: null, studentCount: Number(r.student_count) || 0,
            districtCount: Number(r.district_count) || 0,
            filterPlace: r.filter_place ?? null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Месячный срез для регионов — параллель getRegionStatistics, читает v_region_month_scores/
     * v_region_month_places. averageScore — всегда null, см. комментарий в
     * getTeacherStatisticsByMonth. place — из view (не пересчитывается на лету, как и в годовом пути).
     */
    private async getRegionStatisticsByMonth(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string,
        monthFilter: { year: number; month: number },
        examTypeId: number
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";

        const baseQuery = () => {
            let q = pg
                .selectFrom("regions as r")
                .leftJoin("v_region_month_scores as rms", (join) =>
                    join.onRef("rms.region_id", "=", "r.id").on("rms.year", "=", monthFilter.year)
                        .on("rms.month", "=", monthFilter.month).on("rms.exam_type_id", "=", examTypeId)
                )
                .where("r.active", "=", true);
            if (filters.regionIds && filters.regionIds.length > 0) q = q.where("r.id", "in", filters.regionIds);
            return q;
        };

        const filterPlaceExpr = sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(rms.score, 0) DESC)`;
        const sortMap: Record<string, any> = {
            score: sql`rms.score`,
            // averageScore не существует в месячном срезе — подменяем на score.
            averageScore: sql`rms.score`,
            place: sql`rmp.place`, code: sql`r.code`, name: sql`r.name COLLATE az_ci`,
            studentCount: sql`student_count`, districtCount: sql`district_count`, filterPlace: sql`filter_place`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`rms.score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;
        const studentCountExpr = sql<number>`(SELECT count(*) FROM students st JOIN districts d ON d.id = st.district_id WHERE d.region_id = r.id)`;
        const districtCountExpr = sql<number>`(SELECT count(*) FROM districts dd WHERE dd.region_id = r.id)`;

        const [rows, countRow] = await Promise.all([
            baseQuery()
                .leftJoin("v_region_month_places as rmp", (join) =>
                    join.onRef("rmp.region_id", "=", "r.id").on("rmp.year", "=", monthFilter.year)
                        .on("rmp.month", "=", monthFilter.month).on("rmp.exam_type_id", "=", examTypeId)
                )
                .select(["r.id as id", "r.code as code", "r.name as name", "rms.score as score", "rmp.place as place"])
                .select(studentCountExpr.as("student_count"))
                .select(districtCountExpr.as("district_count"))
                .select(filterPlaceExpr.as("filter_place"))
                // NULLS LAST: регионы без результатов в этом месяце иначе всплывают в начало при DESC.
                .orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip).execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
        ]);

        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, name: r.name, score: r.score ?? 0, averageScore: null,
            place: r.place, districtPlace: null, studentCount: Number(r.student_count) || 0,
            districtCount: Number(r.district_count) || 0,
            filterPlace: r.filter_place ?? null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Район — особый случай: place пересчитывается на лету под выбранную колонку сортировки
     * (score или averageScore), над ВСЕМИ районами в рамках code-фильтра — так было и в Mongo-версии
     * (assignPlaces(allData, sortColumn)), сохранено как есть, а не "исправлено" молча.
     * districtIds влияет только на то, какие из уже проранжированных районов вернуть, не на сам ранг.
     */
    async getDistrictStatistics(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const currentYear = filters.academicYear ?? getCurrentAcademicYear();
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const examTypeId = await resolveExamTypeId(filters.examTypeId);

        // Месячный режим — отдельная ветка, см. комментарий в getTeacherStatistics.
        const monthFilter = parseMonthFilter(filters.month);
        if (monthFilter) {
            return this.getDistrictStatisticsByMonth(filters, sortColumn, sortDirection, monthFilter, examTypeId);
        }

        let query = pg
            .selectFrom("districts as d")
            .leftJoin("district_year_ratings as dyr", (join) =>
                join.onRef("dyr.district_id", "=", "d.id").on("dyr.year", "=", currentYear).on("dyr.exam_type_id", "=", examTypeId)
            )
            .select(["d.id as id", "d.code as code", "d.name as name", "d.region_id as region_id", "d.student_count as student_count", "dyr.score as score", "dyr.average_score as average_score"])
            // filterPlace: dense rank by score within this exact (code-filtered) scope — same reasoning
            // as getTeacherStatistics above; matches what buildFilterPlaceMap used to compute over allData.
            .select(sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(dyr.score, 0) DESC)`.as("filter_place"))
            .orderBy(sql`d.name COLLATE az_ci`);
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            query = query.where("d.code", ">=", parseInt(start)).where("d.code", "<=", parseInt(end));
        }

        const allData = await query.execute();
        const regionIdById = new Map(allData.map((r) => [r.id, r.region_id]));

        // По умолчанию (без явной сортировки по averageScore) место — по сырому score, как и в
        // персистентном v_district_places/district_year_ratings.place, а не по среднему баллу —
        // иначе первая загрузка /stats (район) показывала бы место, не совпадающее с профилем
        // района, пока пользователь не кликнет по колонке вручную. Решение 20.08.2026.
        // Это ИМЕННО про число в колонке "place" — какой колонкой фактически отсортирован
        // возвращаемый список, решается отдельно ниже (sortAccessors), не смешивать.
        const rankColumn: "score" | "average_score" = sortColumn === "averageScore" ? "average_score" : "score";
        const sorted = [...allData].sort((a, b) => ((b[rankColumn] ?? 0) as number) - ((a[rankColumn] ?? 0) as number));
        const placeById = new Map<number, number>();
        let place = 1;
        sorted.forEach((r, i) => {
            if (i > 0 && ((r[rankColumn] ?? 0) as number) < ((sorted[i - 1][rankColumn] ?? 0) as number)) place = i + 1;
            placeById.set(r.id, place);
        });

        const withPlace: RankedEntity[] = allData.map((r) => ({
            id: r.id, code: r.code, name: r.name, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: placeById.get(r.id) ?? null, districtPlace: null,
            filterPlace: r.filter_place ?? null, studentCount: r.student_count ?? 0,
        }));

        // Actual row order for the response — independent of how "place" above was computed.
        // Previously this always re-sorted by rankColumn regardless of what the user clicked, so
        // "Kodu"/"Adı"/"Şagird sayı"/"Yer"/"Filtr üzrə yer" headers didn't change the order at all.
        const sortAccessors: Record<string, (r: RankedEntity) => number> = {
            code: (r) => r.code, studentCount: (r) => r.studentCount ?? 0,
            place: (r) => r.place ?? 0, filterPlace: (r) => r.filterPlace ?? 0,
            score: (r) => r.score ?? 0, averageScore: (r) => r.averageScore ?? 0,
        };
        const dir = sortDirection === "asc" ? 1 : -1;
        let ordered: RankedEntity[];
        if (sortColumn === "name") {
            // Already fetched in az_ci order (see query.orderBy above) — just flip it for desc.
            ordered = sortDirection === "asc" ? withPlace : [...withPlace].reverse();
        } else {
            const accessor = sortAccessors[sortColumn] ?? sortAccessors[rankColumn === "score" ? "score" : "averageScore"];
            ordered = [...withPlace].sort((a, b) => dir * (accessor(a) - accessor(b)));
        }

        let data: RankedEntity[];
        let totalCount: number;
        const districtIdSet = filters.districtIds && filters.districtIds.length > 0 ? new Set(filters.districtIds) : null;
        const regionIdSet = filters.regionIds && filters.regionIds.length > 0 ? new Set(filters.regionIds) : null;
        if (districtIdSet || regionIdSet) {
            // Обе фильтрации, если заданы одновременно, комбинируются через И — на практике не
            // пересекаются (districtIds ставит role-скоуп regionRepresenter/districtRepresenter,
            // regionIds — ручной фильтр в UI), но так корректно в любом случае.
            data = ordered.filter((d) => {
                if (districtIdSet && !districtIdSet.has(d.id)) return false;
                if (regionIdSet) {
                    const regionId = regionIdById.get(d.id);
                    if (regionId == null || !regionIdSet.has(regionId)) return false;
                }
                return true;
            });
            totalCount = data.length;
        } else {
            totalCount = ordered.length;
            data = ordered.slice(skip, skip + size);
        }

        return { data, totalCount };
    }

    /**
     * Месячный срез для районов — параллель getDistrictStatistics (тот же приём "place считается
     * на лету поверх code-фильтрованной выборки"), читает v_district_month_scores вместо
     * district_year_ratings. averageScore в месячном срезе не существует: ранг — всегда по
     * сырому score (не по rankColumn "score"/"average_score", как в годовом пути), и сортировка
     * по averageScore подменяется на score (требование 4 задачи, а не молчаливая поломка запроса).
     */
    private async getDistrictStatisticsByMonth(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string,
        monthFilter: { year: number; month: number },
        examTypeId: number
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;

        let query = pg
            .selectFrom("districts as d")
            .leftJoin("v_district_month_scores as dms", (join) =>
                join.onRef("dms.district_id", "=", "d.id").on("dms.year", "=", monthFilter.year)
                    .on("dms.month", "=", monthFilter.month).on("dms.exam_type_id", "=", examTypeId)
            )
            .select(["d.id as id", "d.code as code", "d.name as name", "d.region_id as region_id", "d.student_count as student_count", "dms.score as score"])
            .select(sql<number>`DENSE_RANK() OVER (ORDER BY COALESCE(dms.score, 0) DESC)`.as("filter_place"))
            .orderBy(sql`d.name COLLATE az_ci`);
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            query = query.where("d.code", ">=", parseInt(start)).where("d.code", "<=", parseInt(end));
        }

        const allData = await query.execute();
        const regionIdById = new Map(allData.map((r) => [r.id, r.region_id]));

        // Место — dense rank по сырому score за месяц (среднего в месячном срезе нет вовсе, ветвить
        // по rankColumn, как в годовом пути, здесь незачем).
        const sorted = [...allData].sort((a, b) => ((b.score ?? 0) as number) - ((a.score ?? 0) as number));
        const placeById = new Map<number, number>();
        let place = 1;
        sorted.forEach((r, i) => {
            if (i > 0 && ((r.score ?? 0) as number) < ((sorted[i - 1].score ?? 0) as number)) place = i + 1;
            placeById.set(r.id, place);
        });

        const withPlace: RankedEntity[] = allData.map((r) => ({
            id: r.id, code: r.code, name: r.name, score: r.score ?? 0, averageScore: null,
            place: placeById.get(r.id) ?? null, districtPlace: null,
            filterPlace: r.filter_place ?? null, studentCount: r.student_count ?? 0,
        }));

        // averageScore недоступен в месячном срезе — сортировка по нему подменяется на score.
        const effectiveSortColumn = sortColumn === "averageScore" ? "score" : sortColumn;
        const sortAccessors: Record<string, (r: RankedEntity) => number> = {
            code: (r) => r.code, studentCount: (r) => r.studentCount ?? 0,
            place: (r) => r.place ?? 0, filterPlace: (r) => r.filterPlace ?? 0,
            score: (r) => r.score ?? 0,
        };
        const dir = sortDirection === "asc" ? 1 : -1;
        let ordered: RankedEntity[];
        if (effectiveSortColumn === "name") {
            // Already fetched in az_ci order (see query.orderBy above) — just flip it for desc.
            ordered = sortDirection === "asc" ? withPlace : [...withPlace].reverse();
        } else {
            const accessor = sortAccessors[effectiveSortColumn] ?? sortAccessors.score;
            ordered = [...withPlace].sort((a, b) => dir * (accessor(a) - accessor(b)));
        }

        let data: RankedEntity[];
        let totalCount: number;
        const districtIdSet = filters.districtIds && filters.districtIds.length > 0 ? new Set(filters.districtIds) : null;
        const regionIdSet = filters.regionIds && filters.regionIds.length > 0 ? new Set(filters.regionIds) : null;
        if (districtIdSet || regionIdSet) {
            data = ordered.filter((d) => {
                if (districtIdSet && !districtIdSet.has(d.id)) return false;
                if (regionIdSet) {
                    const regionId = regionIdById.get(d.id);
                    if (regionId == null || !regionIdSet.has(regionId)) return false;
                }
                return true;
            });
            totalCount = data.length;
        } else {
            totalCount = ordered.length;
            data = ordered.slice(skip, skip + size);
        }

        return { data, totalCount };
    }
}

export const statsServicePg = new StatsServicePg();
