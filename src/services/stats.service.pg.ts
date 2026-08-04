import { sql } from "kysely";
import { pg } from "../config/pg";
import { getCurrentAcademicYear } from "../utils/academic-year.util";
import { FilterOptionsPg } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { escapeRegex } from "../utils/validation.util";

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
        id: number; code: number; lastName: string | null; firstName: string; middleName: string | null;
        grade: number | null; averageScore: number | null;
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

    /** Пересчёт для текущего календарного месяца — вызывается после импорта результатов. */
    async updateStats(): Promise<number> {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        const count = await pg
            .selectFrom("student_results")
            .select(({ fn }) => fn.countAll().as("c"))
            .where("month", "=", month)
            .where("year", "=", year)
            .executeTakeFirstOrThrow();

        if (Number(count.c) === 0) {
            await this.recomputeStudentRatings(getCurrentAcademicYear());
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
        await this.recomputeStudentRatings(getCurrentAcademicYear());

        return 200;
    }

    /** Полный пересчёт учебного года — сентябрь-июнь, плюс учителя/школы/районы. */
    async updateAllStats(): Promise<number> {
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const academicYearStart = currentMonth >= 9 ? currentYear : currentYear - 1;
        const academicYearEnd = academicYearStart + 1;

        // Шаг 0: month/year результатов по факту даты экзамена (данные могли устареть после переноса экзамена)
        await sql`
            UPDATE student_results sr
            SET month = EXTRACT(MONTH FROM e.date)::int, year = EXTRACT(YEAR FROM e.date)::int
            FROM exams e
            WHERE sr.exam_id = e.id
              AND (sr.month <> EXTRACT(MONTH FROM e.date)::int OR sr.year <> EXTRACT(YEAR FROM e.date)::int)
        `.execute(pg);

        // Шаг 1: обнуляем баллы месяца/развития за весь учебный год (сам score студента
        // обнулять вручную не нужно — он всегда пересчитывается заново из view в шаге 3)
        await pg
            .updateTable("student_results")
            .set({ development_score: 0, student_of_the_month_score: 0, republic_wide_student_of_the_month_score: 0 })
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
        // затем учителя/школы/районы (путь B).
        await this.recomputeStudentRatings(academicYearStart);
        await this.recomputeTeacherRatings(academicYearStart);
        await this.recomputeSchoolRatings(academicYearStart);
        await this.recomputeDistrictRatings(academicYearStart);

        return 200;
    }

    /**
     * Награждает "студента месяца" — по району (среди учеников того же класса и района)
     * и по республике (среди учеников того же класса) — только если победитель на лицейском
     * уровне (isLiceyLevel). Ученики без района не участвуют ни в одной из двух номинаций —
     * так было и в Mongo-версии (весь результат пропускался, если student.district пуст).
     */
    private async awardStudentOfTheMonth(month: number, year: number): Promise<void> {
        await sql`
            WITH month_results AS (
                SELECT sr.id, sr.grade, s.district_id, sr.total_score, sr.level
                FROM student_results sr
                JOIN students s ON s.id = sr.student_id
                WHERE sr.month = ${month} AND sr.year = ${year} AND s.district_id IS NOT NULL
            ),
            max_district AS (
                SELECT grade, district_id, MAX(total_score) AS max_score
                FROM month_results GROUP BY grade, district_id
            )
            UPDATE student_results SET student_of_the_month_score = 5
            WHERE id IN (
                SELECT mr.id FROM month_results mr
                JOIN max_district md ON md.grade = mr.grade AND md.district_id = mr.district_id AND md.max_score = mr.total_score
                WHERE upper(trim(mr.level)) LIKE '%LISEY%' OR upper(trim(mr.level)) = 'LISE'
            )
        `.execute(pg);

        await sql`
            WITH month_results AS (
                SELECT sr.id, sr.grade, sr.total_score, sr.level
                FROM student_results sr
                JOIN students s ON s.id = sr.student_id
                WHERE sr.month = ${month} AND sr.year = ${year} AND s.district_id IS NOT NULL
            ),
            max_republic AS (
                SELECT grade, MAX(total_score) AS max_score FROM month_results GROUP BY grade
            )
            UPDATE student_results SET republic_wide_student_of_the_month_score = 5
            WHERE id IN (
                SELECT mr.id FROM month_results mr
                JOIN max_republic mrp ON mrp.grade = mr.grade AND mrp.max_score = mr.total_score
                WHERE upper(trim(mr.level)) LIKE '%LISEY%' OR upper(trim(mr.level)) = 'LISE'
            )
        `.execute(pg);
    }

    /**
     * +10 баллов и статус "İnkişaf edən şagird" тем, чей уровень в этом месяце выше
     * максимального уровня из ВСЕХ их более ранних результатов в этом же учебном году.
     * Первый экзамен студента в году никогда не считается развитием (нет с чем сравнивать).
     */
    private async markDevelopingStudents(month: number, year: number): Promise<void> {
        const academicYearStart = month >= 9 ? year : year - 1;

        await sql`
            WITH target AS (
                SELECT sr.id, sr.student_id, sr.total_score, e.date AS exam_date
                FROM student_results sr
                JOIN exams e ON e.id = sr.exam_id
                WHERE sr.month = ${month} AND sr.year = ${year}
            ),
            prior_max AS (
                SELECT t.id, MAX(
                    CASE WHEN sr2.total_score >= 47 THEN 6
                         WHEN sr2.total_score >= 42 THEN 5
                         WHEN sr2.total_score >= 35 THEN 4
                         WHEN sr2.total_score >= 26 THEN 3
                         WHEN sr2.total_score >= 16 THEN 2
                         ELSE 1 END
                ) AS max_prev_level
                FROM target t
                JOIN student_results sr2 ON sr2.student_id = t.student_id
                JOIN exams e2 ON e2.id = sr2.exam_id
                WHERE e2.date < t.exam_date
                  AND e2.date >= make_date(${academicYearStart}, 9, 1)
                GROUP BY t.id
            )
            UPDATE student_results SET status = 'İnkişaf edən şagird', development_score = 10
            WHERE id IN (
                SELECT t.id FROM target t
                JOIN prior_max pm ON pm.id = t.id
                WHERE (CASE WHEN t.total_score >= 47 THEN 6
                            WHEN t.total_score >= 42 THEN 5
                            WHEN t.total_score >= 35 THEN 4
                            WHEN t.total_score >= 26 THEN 3
                            WHEN t.total_score >= 16 THEN 2
                            ELSE 1 END) > pm.max_prev_level
            )
        `.execute(pg);
    }

    /** Полная замена строк текущего года — не ручной сброс+пересчёт, а DELETE+INSERT из view. */
    private async recomputeStudentRatings(year: number): Promise<void> {
        await pg.deleteFrom("student_year_ratings").where("year", "=", year).execute();
        await sql`
            INSERT INTO student_year_ratings (student_id, year, score, average_score, place, district_place)
            SELECT sc.student_id, sc.academic_year, sc.score, sc.average_score, p.place, p.district_place
            FROM v_student_year_scores sc
            LEFT JOIN v_student_places p ON p.student_id = sc.student_id AND p.academic_year = sc.academic_year
            WHERE sc.academic_year = ${year}
        `.execute(pg);
    }

    private async recomputeTeacherRatings(year: number): Promise<void> {
        await pg.deleteFrom("teacher_year_ratings").where("year", "=", year).execute();
        await sql`
            INSERT INTO teacher_year_ratings (teacher_id, year, score, average_score, place, district_place)
            SELECT ts.teacher_id, ts.academic_year, ts.score, ts.average_score, p.place, p.district_place
            FROM v_teacher_year_scores ts
            LEFT JOIN v_teacher_places p ON p.teacher_id = ts.teacher_id AND p.academic_year = ts.academic_year
            WHERE ts.academic_year = ${year}
        `.execute(pg);
    }

    private async recomputeSchoolRatings(year: number): Promise<void> {
        await pg.deleteFrom("school_year_ratings").where("year", "=", year).execute();
        await sql`
            INSERT INTO school_year_ratings (school_id, year, score, average_score, place, district_place)
            SELECT ss.school_id, ss.academic_year, ss.score, ss.average_score, p.place, p.district_place
            FROM v_school_year_scores ss
            LEFT JOIN v_school_places p ON p.school_id = ss.school_id AND p.academic_year = ss.academic_year
            WHERE ss.academic_year = ${year}
        `.execute(pg);
    }

    private async recomputeDistrictRatings(year: number): Promise<void> {
        await pg.deleteFrom("district_year_ratings").where("year", "=", year).execute();
        await sql`
            INSERT INTO district_year_ratings (district_id, year, score, average_score, place)
            SELECT ds.district_id, ds.academic_year, ds.score, ds.average_score, p.place
            FROM v_district_year_scores ds
            LEFT JOIN v_district_places p ON p.district_id = ds.district_id AND p.academic_year = ds.academic_year
            WHERE ds.academic_year = ${year}
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

    private async resolveExamIds(filters: StatisticsFilterPg): Promise<number[]> {
        if (filters.examIds && filters.examIds.length > 0) return filters.examIds;
        if (!filters.month) throw new Error("Month is required");
        const { startDate, endDate } = RequestParser.parseMonthRange(filters.month);
        const rows = await pg.selectFrom("exams").select("id").where("date", ">=", startDate).where("date", "<", endDate).execute();
        return rows.map((r) => r.id);
    }

    private async queryStudentResultStats(filters: StatisticsFilterPg, examIds: number[]): Promise<StudentResultStatRow[]> {
        const currentYear = getCurrentAcademicYear();

        let query = pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .leftJoin("teachers as t", "t.id", "st.teacher_id")
            .leftJoin("schools as sc", "sc.id", "st.school_id")
            .leftJoin("districts as d", "d.id", "st.district_id")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            .leftJoin("student_year_ratings as syr", (join) =>
                join.onRef("syr.student_id", "=", "st.id").on("syr.year", "=", currentYear)
            )
            .where("sr.exam_id", "in", examIds)
            .select([
                "sr.id as id", "sr.exam_id as exam_id", "sr.grade as grade", "sr.total_score as total_score",
                "sr.level as level", "sr.status as status", "sr.development_score as development_score",
                "sr.student_of_the_month_score as student_of_the_month_score",
                "sr.republic_wide_student_of_the_month_score as republic_wide_student_of_the_month_score",
                "sr.month as month", "sr.year as year",
                "st.id as student_id", "st.code as student_code", "st.last_name as student_last_name",
                "st.first_name as student_first_name", "st.middle_name as student_middle_name", "st.grade as student_grade",
                "syr.average_score as student_average_score",
                "t.id as teacher_id", "t.fullname as teacher_fullname",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as district_id", "d.name as district_name",
                "e.id as e_id", "e.name as e_name", "e.date as e_date",
            ]);

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
                level: sql`(CASE sr.level WHEN 'E' THEN 1 WHEN 'D' THEN 2 WHEN 'C' THEN 3 WHEN 'B' THEN 4 WHEN 'A' THEN 5 WHEN 'Lisey' THEN 6 ELSE 0 END)`,
                code: sql`st.code`, lastName: sql`st.last_name COLLATE az_ci`, firstName: sql`st.first_name COLLATE az_ci`,
                middleName: sql`st.middle_name COLLATE az_ci`, grade: sql`st.grade`,
                teacher: sql`t.fullname COLLATE az_ci`, school: sql`sc.name COLLATE az_ci`, district: sql`d.name COLLATE az_ci`,
                totalScore: sql`sr.total_score`, averageScore: sql`syr.average_score`,
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
            month: r.month, year: r.year,
            studentData: {
                id: r.student_id, code: r.student_code, lastName: r.student_last_name, firstName: r.student_first_name,
                middleName: r.student_middle_name, grade: r.student_grade, averageScore: r.student_average_score,
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
    private buildFilterPlaceMap(rows: { id: number; score: number | null }[]): Map<number, number> {
        const sorted = [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const map = new Map<number, number>();
        let place = 1;
        let prevScore: number | null = null;
        sorted.forEach((r, i) => {
            const score = r.score ?? 0;
            if (i > 0 && score < prevScore!) place = i + 1;
            map.set(r.id, place);
            prevScore = score;
        });
        return map;
    }

    async getTeacherStatistics(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const currentYear = getCurrentAcademicYear();
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";

        const baseQuery = () => {
            let q = pg
                .selectFrom("teachers as t")
                .leftJoin("teacher_year_ratings as tyr", (join) => join.onRef("tyr.teacher_id", "=", "t.id").on("tyr.year", "=", currentYear));
            if (filters.teacherIds && filters.teacherIds.length > 0) {
                q = q.where("t.id", "in", filters.teacherIds);
            } else {
                q = q.where("t.active", "=", true);
                if (filters.districtIds && filters.districtIds.length > 0) q = q.where("t.district_id", "in", filters.districtIds);
                if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("t.school_id", "in", filters.schoolIds);
            }
            return q;
        };

        const isSelfView = !!(filters.teacherIds && filters.teacherIds.length > 0);
        const sortMap: Record<string, any> = {
            score: sql`tyr.score`, averageScore: sql`tyr.average_score`, place: sql`tyr.place`,
            districtPlace: sql`tyr.district_place`, code: sql`t.code`, fullname: sql`t.fullname COLLATE az_ci`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`tyr.average_score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;

        let rowsQuery = baseQuery().select(["t.id as id", "t.code as code", "t.student_count as student_count", "tyr.score as score", "tyr.average_score as average_score", "tyr.place as place", "tyr.district_place as district_place"]);
        if (!isSelfView) {
            // NULLS LAST: учителя без строки в teacher_year_ratings иначе всплывают в начало при DESC.
            rowsQuery = rowsQuery.orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip) as typeof rowsQuery;
        }
        const [rows, countRow, scoreRows] = await Promise.all([
            rowsQuery.execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
            baseQuery().select(["t.id as id", "tyr.score as score"]).execute(),
        ]);

        const filterPlaceMap = this.buildFilterPlaceMap(scoreRows);
        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: r.place, districtPlace: r.district_place, studentCount: r.student_count ?? 0,
            filterPlace: filterPlaceMap.get(r.id) ?? null,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    async getSchoolStatistics(
        filters: FilterOptionsPg & { page?: number; size?: number },
        sortColumn: string,
        sortDirection: string
    ): Promise<{ data: RankedEntity[]; totalCount: number }> {
        const currentYear = getCurrentAcademicYear();
        const page = filters.page ?? 1;
        const size = (filters as any).size ?? 100;
        const skip = (page - 1) * size;
        const dir = sortDirection === "asc" ? "asc" : "desc";

        const baseQuery = () => {
            let q = pg
                .selectFrom("schools as sc")
                .leftJoin("school_year_ratings as syr", (join) => join.onRef("syr.school_id", "=", "sc.id").on("syr.year", "=", currentYear))
                .where("sc.active", "=", true);
            if (filters.districtIds && filters.districtIds.length > 0) q = q.where("sc.district_id", "in", filters.districtIds);
            if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("sc.id", "in", filters.schoolIds);
            return q;
        };

        const sortMap: Record<string, any> = {
            score: sql`syr.score`, averageScore: sql`syr.average_score`, place: sql`syr.place`,
            districtPlace: sql`syr.district_place`, code: sql`sc.code`, name: sql`sc.name COLLATE az_ci`,
        };
        const orderExpr = sortMap[sortColumn] ?? sql`syr.average_score`;
        const dirSql = dir === "asc" ? sql`ASC` : sql`DESC`;

        const [rows, countRow, scoreRows] = await Promise.all([
            baseQuery()
                .select(["sc.id as id", "sc.code as code", "sc.student_count as student_count", "syr.score as score", "syr.average_score as average_score", "syr.place as place", "syr.district_place as district_place"])
                // NULLS LAST: школы без строки в school_year_ratings иначе всплывают в начало при DESC.
                .orderBy(sql`${orderExpr} ${dirSql} NULLS LAST`).limit(size).offset(skip).execute(),
            baseQuery().select(({ fn }) => [fn.countAll().as("count")]).executeTakeFirstOrThrow(),
            baseQuery().select(["sc.id as id", "syr.score as score"]).execute(),
        ]);

        const filterPlaceMap = this.buildFilterPlaceMap(scoreRows);
        const data: RankedEntity[] = rows.map((r) => ({
            id: r.id, code: r.code, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: r.place, districtPlace: r.district_place, studentCount: r.student_count ?? 0,
            filterPlace: filterPlaceMap.get(r.id) ?? null,
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

        let query = pg
            .selectFrom("districts as d")
            .leftJoin("district_year_ratings as dyr", (join) => join.onRef("dyr.district_id", "=", "d.id").on("dyr.year", "=", currentYear))
            .select(["d.id as id", "d.code as code", "d.student_count as student_count", "dyr.score as score", "dyr.average_score as average_score"])
            .orderBy(sql`d.name COLLATE az_ci`);
        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 3);
            query = query.where("d.code", ">=", parseInt(start)).where("d.code", "<=", parseInt(end));
        }

        const allData = await query.execute();

        const rankColumn: "score" | "average_score" = sortColumn === "score" ? "score" : "average_score";
        const sorted = [...allData].sort((a, b) => ((b[rankColumn] ?? 0) as number) - ((a[rankColumn] ?? 0) as number));
        const placeById = new Map<number, number>();
        let place = 1;
        sorted.forEach((r, i) => {
            if (i > 0 && ((r[rankColumn] ?? 0) as number) < ((sorted[i - 1][rankColumn] ?? 0) as number)) place = i + 1;
            placeById.set(r.id, place);
        });
        const filterPlaceMap = this.buildFilterPlaceMap(allData.map((r) => ({ id: r.id, score: r.score })));

        const withPlace: RankedEntity[] = allData.map((r) => ({
            id: r.id, code: r.code, score: r.score ?? 0, averageScore: r.average_score ?? 0,
            place: placeById.get(r.id) ?? null, districtPlace: null,
            filterPlace: filterPlaceMap.get(r.id) ?? null, studentCount: r.student_count ?? 0,
        }));

        let data: RankedEntity[];
        let totalCount: number;
        if (filters.districtIds && filters.districtIds.length > 0) {
            const idSet = new Set(filters.districtIds);
            data = withPlace.filter((d) => idSet.has(d.id));
            totalCount = data.length;
        } else {
            const sortDir = sortDirection === "asc" ? 1 : -1;
            withPlace.sort((a, b) => sortDir * (((a as any)[rankColumn === "score" ? "score" : "averageScore"] ?? 0) - ((b as any)[rankColumn === "score" ? "score" : "averageScore"] ?? 0)));
            totalCount = withPlace.length;
            data = withPlace.slice(skip, skip + size);
        }

        return { data, totalCount };
    }
}

export const statsServicePg = new StatsServicePg();
