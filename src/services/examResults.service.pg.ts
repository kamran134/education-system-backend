import { sql } from "kysely";
import { pg } from "../config/pg";
import { escapeRegex } from "../utils/validation.util";

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
    exam: { id: number; code: number; name: string; date: Date } | null;
    // disciplines — массив по фактическому набору предметов результата
    // (IMTAHAN_NOVLERI_TASK.md §4/§6, шаг 2), читается из student_result_subject_scores.
    // Диалог редактирования результата (result-editing-dialog.component.ts) рендерит поля
    // предметов циклом по этому массиву, а не пятью статичными блоками.
    disciplines: Array<{ subjectCode: string; nameAz: string; score: number; questionCount: number | null; maxQuestions: number | null }>;
    maxQuestions: number | null;
    scorePercent: number | null;
}

/**
 * Postgres-версия ExamResultsService — см. examResults.service.ts (Mongo) для сравнения.
 * Mongo-версия строила 4-этажный `$lookup`-pipeline вручную (join на students, затем вложенные
 * join на teacher/school/district внутри него, затем join на exams) именно потому, что в
 * document-модели нет способа сделать обычный SQL JOIN. В Postgres это ровно то, для чего JOIN
 * придуман — вся сложность пайплайна схлопывается в один SELECT с четырьмя LEFT JOIN.
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
            .leftJoin("teachers as t", "t.id", "st.teacher_id")
            .leftJoin("schools as sc", "sc.id", "st.school_id")
            .leftJoin("districts as d", "d.id", "st.district_id")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            .leftJoin("levels as lvl", "lvl.code", "sr.level");

        query = this.applyFilter(query, filters);

        const countRow = await query
            .select(({ fn }) => [fn.countAll().as("count")])
            .executeTakeFirstOrThrow();

        const sortExpr = this.mapSort(sortColumn);
        const dirSql = sortDirection === "asc" ? sql`ASC` : sql`DESC`;

        const rows = await query
            .select([
                "sr.id as id", "sr.grade as grade", "sr.total_score as total_score", "sr.level as level", "sr.status as status",
                "sr.section_id as section_id", "sr.max_questions as max_questions", "sr.score_percent as score_percent",
                "st.id as student_id", "st.code as student_code", "st.fullname as student_fullname",
                "t.id as teacher_id", "t.fullname as teacher_fullname",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as district_id", "d.name as district_name",
                "e.id as exam_id", "e.code as exam_code", "e.name as exam_name", "e.date as exam_date",
            ])
            .orderBy(sql`${sortExpr} ${dirSql} NULLS LAST`)
            .limit(size)
            .offset((page - 1) * size)
            .execute();

        const disciplinesByResultId = await this.loadDisciplines(rows.map((r) => r.id), rows.map((r) => r.section_id));

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
            exam: r.exam_id != null ? { id: r.exam_id, code: r.exam_code!, name: r.exam_name!, date: r.exam_date! } : null,
            disciplines: disciplinesByResultId.get(r.id) ?? [],
            maxQuestions: r.max_questions,
            scorePercent: r.score_percent,
        }));

        return { data, totalCount: Number(countRow.count) };
    }

    async getExamResultById(id: number): Promise<ExamResultRow | null> {
        const row = await pg
            .selectFrom("student_results as sr")
            .innerJoin("students as st", "st.id", "sr.student_id")
            .leftJoin("teachers as t", "t.id", "st.teacher_id")
            .leftJoin("schools as sc", "sc.id", "st.school_id")
            .leftJoin("districts as d", "d.id", "st.district_id")
            .leftJoin("exams as e", "e.id", "sr.exam_id")
            .select([
                "sr.id as id", "sr.grade as grade", "sr.total_score as total_score", "sr.level as level", "sr.status as status",
                "sr.section_id as section_id", "sr.max_questions as max_questions", "sr.score_percent as score_percent",
                "st.id as student_id", "st.code as student_code", "st.fullname as student_fullname",
                "t.id as teacher_id", "t.fullname as teacher_fullname",
                "sc.id as school_id", "sc.name as school_name",
                "d.id as district_id", "d.name as district_name",
                "e.id as exam_id", "e.code as exam_code", "e.name as exam_name", "e.date as exam_date",
            ])
            .where("sr.id", "=", id)
            .executeTakeFirst();

        if (!row) return null;
        const disciplinesByResultId = await this.loadDisciplines([row.id], [row.section_id]);
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
            exam: row.exam_id != null ? { id: row.exam_id, code: row.exam_code!, name: row.exam_name!, date: row.exam_date! } : null,
            disciplines: disciplinesByResultId.get(row.id) ?? [],
            maxQuestions: row.max_questions,
            scorePercent: row.score_percent,
        };
    }

    /** Баллы по предметам батчем на набор результатов (024_student_result_subject_scores.sql) —
     *  один доп. запрос на всю страницу, не N+1 на строку. maxQuestions подтягивается из
     *  конфига секции результата (exam_type_section_subjects), а не хранится на строке баллов. */
    private async loadDisciplines(
        resultIds: number[],
        sectionIds: Array<number | null>
    ): Promise<Map<number, Array<{ subjectCode: string; nameAz: string; score: number; questionCount: number | null; maxQuestions: number | null }>>> {
        if (resultIds.length === 0) return new Map();
        const uniqueSectionIds = [...new Set(sectionIds.filter((id): id is number => id != null))];

        const [subjectScoreRows, sectionSubjectRows] = await Promise.all([
            pg
                .selectFrom("student_result_subject_scores as srs")
                .innerJoin("subjects as s", "s.code", "srs.subject_code")
                .select(["srs.result_id", "srs.subject_code", "s.name_az", "srs.score", "srs.question_count"])
                .where("srs.result_id", "in", resultIds)
                .execute(),
            uniqueSectionIds.length > 0
                ? pg
                      .selectFrom("exam_type_section_subjects")
                      .select(["section_id", "subject_code", "max_questions"])
                      .where("section_id", "in", uniqueSectionIds)
                      .execute()
                : Promise.resolve([]),
        ]);

        const sectionByResultId = new Map(resultIds.map((id, i) => [id, sectionIds[i]]));
        const maxQuestionsBySectionSubject = new Map(sectionSubjectRows.map((r) => [`${r.section_id}:${r.subject_code}`, r.max_questions]));

        const map = new Map<number, Array<{ subjectCode: string; nameAz: string; score: number; questionCount: number | null; maxQuestions: number | null }>>();
        for (const s of subjectScoreRows) {
            const sectionId = sectionByResultId.get(s.result_id) ?? null;
            const entry = {
                subjectCode: s.subject_code,
                nameAz: s.name_az,
                score: s.score,
                questionCount: s.question_count,
                maxQuestions: sectionId != null ? maxQuestionsBySectionSubject.get(`${sectionId}:${s.subject_code}`) ?? null : null,
            };
            const list = map.get(s.result_id) ?? [];
            list.push(entry);
            map.set(s.result_id, list);
        }
        return map;
    }

    private applyFilter<Q extends { where: any }>(query: Q, filters: ExamResultsFilterPg): Q {
        let q = query;

        if (filters.examIds && filters.examIds.length > 0) q = q.where("sr.exam_id" as any, "in", filters.examIds);
        if (filters.grades && filters.grades.length > 0) q = q.where("sr.grade" as any, "in", filters.grades);
        if (filters.dateFrom) q = q.where("e.date" as any, ">=", new Date(filters.dateFrom));
        if (filters.dateTo) q = q.where("e.date" as any, "<=", new Date(filters.dateTo));
        if (filters.code !== undefined) q = q.where("st.code" as any, "=", filters.code);
        if (filters.districtIds && filters.districtIds.length > 0) q = q.where("st.district_id" as any, "in", filters.districtIds);
        if (filters.schoolIds && filters.schoolIds.length > 0) q = q.where("st.school_id" as any, "in", filters.schoolIds);
        if (filters.teacherIds && filters.teacherIds.length > 0) q = q.where("st.teacher_id" as any, "in", filters.teacherIds);
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
            // уровень первым, а не алфавитный порядок E<D<C... Справочник levels.rank даёт
            // обратную величину (E=1..Lisey=6), поэтому инвертируем через (7 - rank), что даёт
            // ровно те же числа, что были в старом CASE (Lisey=1..E=6).
            level: sql`(7 - lvl.rank)`,
        };
        return map[column] ?? sql`e.date`;
    }
}

export const examResultsServicePg = new ExamResultsServicePg();
