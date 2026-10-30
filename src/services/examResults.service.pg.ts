import { sql, Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { escapeRegex } from "../utils/validation.util";
import { resolveExamTypeId } from "./examType.service.pg";
import { refreshRatingsInBackground } from "./deletion.service.pg";

/** Ids per DELETE statement — keeps the bind-parameter count far below Postgres' 65535. */
const DELETE_CHUNK = 5000;

/** Rows a delete may touch — same joins as getExamResults, so applyFilter sees the columns it expects. */
function deletableResults(trx: Transaction<DB>) {
    return trx
        .selectFrom("student_results as sr")
        .innerJoin("students as st", "st.id", "sr.student_id")
        .leftJoin("exams as e", "e.id", "sr.exam_id");
}

export interface ExamResultsFilterPg {
    search?: string;
    code?: number;
    dateFrom?: string;
    dateTo?: string;
    examIds?: number[];
    districtIds?: number[];
    schoolIds?: number[];
    teacherIds?: number[];
    studentIds?: number[];
    grades?: number[];
    // IMTAHAN_NOVLERI_TASK.md — экран Nəticələr (fixes 20.09.2026): без него resolveExamTypeId()
    // подставляет базовый тип, чтобы результаты разных типов экзамена не смешивались в одной
    // таблице (у каждого свой набор предметов/шкала, общий список был бы мусором).
    examTypeId?: number;
    // Г3 (29.10.2026): only this academic year (student_results.academic_year). Set by the controller
    // for every role except admin/superadmin.
    academicYear?: number;
}

export interface ExamResultRow {
    id: number;
    grade: number;
    totalScore: number;
    level: string;
    status: string | null;
    // Имя поля studentData (не student) — обязательно: и mapSort ниже, и фронтенд
    // (exam-results.component.html/ts) обращаются именно к studentData.*, тот же паттерн,
    // что и в stats.service.pg.ts.
    studentData: {
        id: number; code: number; fullname: string;
        teacher: { id: number; fullname: string } | null;
        school: { id: number; name: string } | null;
        district: { id: number; name: string } | null;
    };
    exam: { id: number; name: string; date: Date } | null;
    // disciplines — массив по фактическому набору предметов результата
    // (IMTAHAN_NOVLERI_TASK.md §4/§6, шаг 2), читается из student_result_subject_scores.
    // Диалог редактирования результата (result-editing-dialog.component.ts) рендерит поля
    // предметов циклом по этому массиву, а не пятью статичными блоками.
    disciplines: Array<{ subjectCode: string; nameAz: string; score: number; questionCount: number | null }>;
    maxQuestions: number | null;
    scorePercent: number | null;
}

/**
 * Postgres-версия ExamResultsService — см. examResults.service.ts (Mongo) для сравнения.
 * Mongo-версия строила 4-этажный `$lookup`-pipeline вручную (join на students, затем вложенные
 * join на teacher/school/district внутри него, затем join на exams) именно потому, что в
 * document-модели нет способа сделать обычный SQL JOIN. В Postgres это ровно то, для чего JOIN
 * придуман — вся сложность пайплайна схлопывается в один SELECT с четырьмя LEFT JOIN.
 *
 * Учитель / школа / район строки и фильтры по ним берутся из снимка результата (sr.teacher_id / school_id /
 * district_id, 038_result_snapshot.sql), а не из текущих связей ученика: результат остаётся там, где писали экзамен.
 */
export class ExamResultsServicePg {
    async getExamResults(
        filters: ExamResultsFilterPg,
        sortColumn: string = "exam.date",
        sortDirection: string = "desc",
        page: number = 1,
        size: number = 25
    ): Promise<{ data: ExamResultRow[]; totalCount: number }> {
        let query = pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .leftJoin("teachers as t", "t.id", "sr.teacher_id")
            .leftJoin("schools as sc", "sc.id", "sr.school_id")
            .leftJoin("districts as d", "d.id", "sr.district_id")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            // levels снесена миграцией 026 (IMTAHAN_NOVLERI_TASK.md §20) — level_scale_bands,
            // композитный джойн по (scale_id, code), тем же критерием, что и student_results
            // FK level_band_fkey (024).
            .leftJoin("level_scale_bands as lvl", (join) =>
                join.onRef("lvl.scale_id", "=", "sr.level_scale_id").onRef("lvl.code", "=", "sr.level")
            );

        // Без examTypeId — базовый тип (см. комментарий у ExamResultsFilterPg.examTypeId выше).
        const examTypeId = await resolveExamTypeId(filters.examTypeId);
        query = this.applyFilter(query, { ...filters, examTypeId });

        const countRow = await query
            .select(({ fn }) => [fn.countAll().as("count")])
            .executeTakeFirstOrThrow();

        const sortExpr = this.mapSort(sortColumn);
        const dirSql = sortDirection === "asc" ? sql`ASC` : sql`DESC`;

        const rows = await query
            .select([
                "sr.id as id", "sr.grade as grade", "sr.total_score as total_score", "sr.level as level", "sr.status as status",
                "sr.max_questions as max_questions", "sr.score_percent as score_percent",
                "st.id as student_id", "st.code as student_code", "st.fullname as student_fullname",
                "t.id as teacher_id", "t.fullname as teacher_fullname",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as district_id", "d.name as district_name",
                "e.id as exam_id", "e.name as exam_name", "e.date as exam_date",
            ])
            .orderBy(sql`${sortExpr} ${dirSql} NULLS LAST`)
            .limit(size)
            .offset((page - 1) * size)
            .execute();

        const disciplinesByResultId = await this.loadDisciplines(rows.map((r) => r.id));

        const data: ExamResultRow[] = rows.map((r) => ({
            id: r.id,
            grade: r.grade,
            totalScore: r.total_score,
            level: r.level,
            status: r.status,
            studentData: {
                id: r.student_id, code: r.student_code, fullname: r.student_fullname,
                teacher: r.teacher_id != null ? { id: r.teacher_id, fullname: r.teacher_fullname! } : null,
                school: r.school_id != null ? { id: r.school_id, name: r.school_name! } : null,
                district: r.district_id != null ? { id: r.district_id, name: r.district_name! } : null,
            },
            exam: r.exam_id != null ? { id: r.exam_id, name: r.exam_name!, date: r.exam_date! } : null,
            disciplines: disciplinesByResultId.get(r.id) ?? [],
            maxQuestions: r.max_questions,
            scorePercent: r.score_percent,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    /**
     * Id of the most recent exam (by date) that has at least one result inside the caller's filter scope — the
     * /exam-results page preselects it (Г3 A). Same filter as getExamResults, minus examIds; no count, one row.
     */
    async getLatestExamId(filters: ExamResultsFilterPg): Promise<number | null> {
        let query = pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .innerJoin("exams as e", "e.id", "sr.exam_id");

        const examTypeId = await resolveExamTypeId(filters.examTypeId);
        query = this.applyFilter(query, { ...filters, examIds: undefined, examTypeId });

        const row = await query
            .select(["sr.exam_id as exam_id"])
            .orderBy("e.date", "desc")
            .orderBy("e.id", "desc")
            .limit(1)
            .executeTakeFirst();

        return row?.exam_id ?? null;
    }

    /**
     * Deletes every result the /exam-results filter selects — the "Filtrə uyğun nəticələri sil" button (customer
     * request 29.10.2026: a district deletes its rows of an exam and re-uploads a corrected file). Same joins and
     * filter as getExamResults, so exactly the rows on screen go (results of hidden students are not on screen
     * and stay). Guards: at least one exam must be chosen, and a closed academic year is never touched — its
     * *_year_ratings are sealed (academic_year_closures). The current year's ratings are recomputed afterwards.
     */
    async deleteExamResults(filters: ExamResultsFilterPg): Promise<number> {
        if (!filters.examIds || filters.examIds.length === 0) {
            const err: any = new Error("Silmək üçün ən azı bir imtahan seçin");
            err.status = 400;
            throw err;
        }
        const examTypeId = await resolveExamTypeId(filters.examTypeId);

        return this.deleteMatching((trx) => this.applyFilter(deletableResults(trx), { ...filters, examTypeId }));
    }

    /**
     * Deletes the rows ticked on /exam-results — the "Seçilmişləri sil" link (30.10.2026). Admin-only, so no scope
     * narrowing; the closed-year guard, students.status reset and rating refresh are the same as for the filter.
     */
    async deleteExamResultsByIds(ids: number[]): Promise<number> {
        if (ids.length === 0) {
            const err: any = new Error("Silmək üçün ən azı bir nəticə seçin");
            err.status = 400;
            throw err;
        }
        return this.deleteMatching((trx) => deletableResults(trx).where("sr.id", "in", ids));
    }

    /** Shared body of both deletes: refuses closed years (409), deletes in chunks, resets students.status. */
    private async deleteMatching(
        buildMatching: (trx: Transaction<DB>) => ReturnType<typeof deletableResults>
    ): Promise<number> {
        const deletedCount = await pg.transaction().execute(async (trx) => {
            const matching = buildMatching(trx);

            const closed = await matching
                .select("sr.academic_year as academic_year")
                .where("sr.academic_year", "in", trx.selectFrom("academic_year_closures").select("academic_year"))
                .limit(1)
                .executeTakeFirst();
            if (closed) {
                const err: any = new Error(
                    `Seçilmiş nəticələr arasında bağlanmış ${closed.academic_year}/${Number(closed.academic_year) + 1} ` +
                    `tədris ilinin nəticələri var — onları silmək olmaz`
                );
                err.status = 409;
                throw err;
            }

            const rows = await matching.select(["sr.id as id", "sr.student_id as student_id"]).execute();
            const ids = rows.map((r) => r.id);
            const studentIds = Array.from(new Set(rows.map((r) => r.student_id)));
            for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
                await trx.deleteFrom("student_results").where("id", "in", ids.slice(i, i + DELETE_CHUNK)).execute();
            }
            // Same as deleteResultsByExamId (studentResult.service.pg.ts).
            for (let i = 0; i < studentIds.length; i += DELETE_CHUNK) {
                await trx.updateTable("students").set({ status: null }).where("id", "in", studentIds.slice(i, i + DELETE_CHUNK)).execute();
            }
            return ids.length;
        });

        if (deletedCount > 0) refreshRatingsInBackground();
        return deletedCount;
    }

    async getExamResultById(id: number): Promise<ExamResultRow | null> {
        const row = await pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .leftJoin("teachers as t", "t.id", "sr.teacher_id")
            .leftJoin("schools as sc", "sc.id", "sr.school_id")
            .leftJoin("districts as d", "d.id", "sr.district_id")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            .select([
                "sr.id as id", "sr.grade as grade", "sr.total_score as total_score", "sr.level as level", "sr.status as status",
                "sr.max_questions as max_questions", "sr.score_percent as score_percent",
                "st.id as student_id", "st.code as student_code", "st.fullname as student_fullname",
                "t.id as teacher_id", "t.fullname as teacher_fullname",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as district_id", "d.name as district_name",
                "e.id as exam_id", "e.name as exam_name", "e.date as exam_date",
            ])
            .where("sr.id", "=", id)
            .executeTakeFirst();

        if (!row) return null;
        const disciplinesByResultId = await this.loadDisciplines([row.id]);
        return {
            id: row.id,
            grade: row.grade,
            totalScore: row.total_score,
            level: row.level,
            status: row.status,
            studentData: {
                id: row.student_id, code: row.student_code, fullname: row.student_fullname,
                teacher: row.teacher_id != null ? { id: row.teacher_id, fullname: row.teacher_fullname! } : null,
                school: row.school_id != null ? { id: row.school_id, name: row.school_name! } : null,
                district: row.district_id != null ? { id: row.district_id, name: row.district_name! } : null,
            },
            exam: row.exam_id != null ? { id: row.exam_id, name: row.exam_name!, date: row.exam_date! } : null,
            disciplines: disciplinesByResultId.get(row.id) ?? [],
            maxQuestions: row.max_questions,
            scorePercent: row.score_percent,
        };
    }

    /** Баллы по предметам батчем на набор результатов (024_student_result_subject_scores.sql) —
     *  один доп. запрос на всю страницу, не N+1 на строку. §16: maxQuestions по предмету больше
     *  не существует как отдельное понятие (exam_type_section_subjects.max_questions снят
     *  025d_question_counts_from_file.sql) — questionCount на строке баллов И ЕСТЬ число
     *  вопросов по предмету в этой работе, JOIN на конфиг секции не нужен. */
    private async loadDisciplines(
        resultIds: number[]
    ): Promise<Map<number, Array<{ subjectCode: string; nameAz: string; score: number; questionCount: number | null }>>> {
        if (resultIds.length === 0) return new Map();

        const subjectScoreRows = await pg
            .selectFrom("student_result_subject_scores as srs")
            .innerJoin("subjects as s", "s.code", "srs.subject_code")
            .select(["srs.result_id", "srs.subject_code", "s.name_az", "srs.score", "srs.question_count"])
            .where("srs.result_id", "in", resultIds)
            .execute();

        const map = new Map<number, Array<{ subjectCode: string; nameAz: string; score: number; questionCount: number | null }>>();
        for (const s of subjectScoreRows) {
            const entry = {
                subjectCode: s.subject_code,
                nameAz: s.name_az,
                score: s.score,
                questionCount: s.question_count,
            };
            const list = map.get(s.result_id) ?? [];
            list.push(entry);
            map.set(s.result_id, list);
        }
        return map;
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: ExamResultsFilterPg): Q {
        let q = query;

        if (filters.examTypeId !== undefined) q = q.where("sr.exam_type_id" as any, "=", filters.examTypeId);
        if (filters.examIds && filters.examIds.length > 0) q = q.where("sr.exam_id" as any, "in", filters.examIds);
        if (filters.academicYear !== undefined) q = q.where("sr.academic_year" as any, "=", filters.academicYear);
        if (filters.grades && filters.grades.length > 0) q = q.where("sr.grade" as any, "in", filters.grades);
        if (filters.dateFrom) q = q.where("e.date" as any, ">=", new Date(filters.dateFrom));
        if (filters.dateTo) q = q.where("e.date" as any, "<=", new Date(filters.dateTo));
        if (filters.code !== undefined) q = q.where("st.code" as any, "=", filters.code);
        if (filters.districtIds && filters.districtIds.length > 0) q = q.where("sr.district_id" as any, "in", filters.districtIds);
        if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("sr.school_id" as any, "in", filters.schoolIds);
        if (filters.teacherIds && filters.teacherIds.length > 0) q = q.where("sr.teacher_id" as any, "in", filters.teacherIds);
        if (filters.studentIds && filters.studentIds.length > 0) q = q.where("st.id" as any, "in", filters.studentIds);

        if (filters.search) {
            const terms = filters.search.trim().split(/\s+/).map(escapeRegex);
            for (const term of terms) {
                q = q.where((eb: any) => eb("st.fullname", "ilike", `%${term}%`)) as Q;
            }
        }

        return q;
    }

    private mapSort(column: string) {
        const map: Record<string, any> = {
            "exam.date": sql`e.date`,
            "studentData.code": sql`st.code`,
            "studentData.fullname": sql`st.fullname COLLATE az_ci`,
            "studentData.school.name": sql`sc.name COLLATE az_ci`,
            "studentData.teacher.fullname": sql`t.fullname COLLATE az_ci`,
            "studentData.district.name": sql`d.name COLLATE az_ci`,
            grade: sql`sr.grade`,
            totalScore: sql`sr.total_score`,
            // Mongo-версия сортировала level через ручной levelPriority (Lisey=1..E=6) — лучший
            // уровень первым, а не алфавитный порядок E<D<C... level_scale_bands.rank даёт
            // обратную величину (E=1..Lisey=6), поэтому инвертируем через (7 - rank), что даёт
            // ровно те же числа, что были в старом CASE (Lisey=1..E=6).
            level: sql`(7 - lvl.rank)`,
        };
        return map[column] ?? sql`e.date`;
    }
}

export const examResultsServicePg = new ExamResultsServicePg();
