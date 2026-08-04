import fs from "fs";
import { sql } from "kysely";
import { pg } from "../config/pg";
import { calculateLevelNumb } from "./common.service";
import { studentServicePg, StudentCreate } from "./student.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions } from "../types/common.types";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { calculateParticipationScore } from "../types/participation.types";
import { CODE_DIVISORS, CODE_RANGES } from "../utils/entity-codes.const";

export interface StudentResultDisciplines {
    az: number;
    math: number;
    lifeKnowledge?: number | null;
    logic?: number | null;
    english?: number | null;
}

export interface StudentRef {
    id: number;
    code: number;
    lastName: string | null;
    firstName: string;
    middleName: string | null;
}

export interface ExamRef {
    id: number;
    code: number;
    name: string;
    date: Date;
}

export interface StudentResult {
    id: number;
    studentId: number;
    examId: number | null;
    grade: number;
    disciplines: StudentResultDisciplines;
    questionCounts: StudentResultDisciplines;
    totalScore: number;
    level: string;
    score: number;
    participationScore: number;
    developmentScore: number | null;
    studentOfTheMonthScore: number | null;
    republicWideStudentOfTheMonthScore: number | null;
    status: string | null;
    month: number;
    year: number;
    student?: StudentRef;
    exam?: ExamRef | null;
}

export interface StudentResultCreate {
    studentId: number;
    examId?: number | null;
    grade: number;
    disciplines: StudentResultDisciplines;
    questionCounts: StudentResultDisciplines;
    totalScore: number;
    level: string;
    participationScore: number;
    score: number;
    status?: string | null;
    month: number;
    year: number;
}

type StudentResultRowRaw = {
    id: number; student_id: number; exam_id: number | null; grade: number;
    az: number; math: number; life_knowledge: number | null; logic: number | null; english: number | null;
    az_count: number; math_count: number; life_knowledge_count: number | null; logic_count: number | null; english_count: number | null;
    total_score: number; level: string; score: number; participation_score: number;
    development_score: number | null; student_of_the_month_score: number | null; republic_wide_student_of_the_month_score: number | null;
    status: string | null; month: number; year: number;
};

/**
 * Postgres-версия StudentResultService — см. studentResult.service.ts (Mongo) для сравнения.
 *
 * **Не перенесены (мёртвый код, подтверждено grep 04.08.2026):** `markAllDevelopingStudents`,
 * `markTopStudents`, `markTopStudentsRepublic` — вызывались только из `StatsService.updateStatsOld()`/
 * `resetStats()`, которые сами уже подтверждены мёртвыми при переносе stats.service.ts (шаг 8).
 * `markDevelopingStudents(month,year)` — единственная из этой группы, что реально вызывается
 * (из живого `StatsService.updateStats()`/`updateAllStats()`) — уже перенесена как приватный метод
 * прямо внутри `stats.service.pg.ts` (та же SQL-логика, проверена дифференциальным тестом на шаге 9).
 * `createBulk` и 4 отдельных экспорта `deleteStudentResultsBy*` — не вызываются из usecase/controller
 * ни в Mongo-, ни в Postgres-версии (их место занято collision-safe транзакциями внутри
 * exam.service.pg.ts/student.service.pg.ts).
 *
 * **Мелкая находка внутри `processStudentResultsFromExcel`:** валидация кодов учителей/школ/районов
 * (invalidTeacherCodes/invalidSchoolCodes/invalidDistrictCodes) считалась в Mongo-версии, но НИКОГДА
 * не попадала в возвращаемый результат (ни в лог, ни в ответ) — мёртвые вычисления без наблюдаемого
 * эффекта. Не перенесены — 3 запроса к БД без всякого следа в поведении.
 */
export class StudentResultServicePg {
    async findById(id: number): Promise<StudentResult | null> {
        const row = await pg.selectFrom("student_results").selectAll().where("id", "=", id).executeTakeFirst();
        if (!row) return null;
        return (await this.attachRefs([row]))[0];
    }

    async getResultsByStudentId(studentId: number): Promise<StudentResult[]> {
        const rows = await pg.selectFrom("student_results").selectAll().where("student_id", "=", studentId).execute();
        return await this.attachRefs(rows);
    }

    async getResultsByExamId(examId: number): Promise<StudentResult[]> {
        const rows = await pg.selectFrom("student_results").selectAll().where("exam_id", "=", examId).execute();
        return await this.attachRefs(rows);
    }

    async create(data: StudentResultCreate): Promise<StudentResult> {
        const row = await pg
            .insertInto("student_results")
            .values(this.toColumns(data) as any)
            .returningAll()
            .executeTakeFirstOrThrow();
        return (await this.attachRefs([row]))[0];
    }

    async update(id: number, data: Partial<StudentResultCreate>): Promise<StudentResult> {
        const row = await pg
            .updateTable("student_results")
            .set(this.toColumns(data))
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("Student result not found");
        return (await this.attachRefs([row]))[0];
    }

    async delete(id: number): Promise<void> {
        const result = await pg.deleteFrom("student_results").where("id", "=", id).executeTakeFirst();
        if (Number(result.numDeletedRows) === 0) throw new Error("Student result not found");
    }

    /** Mongo-версия фильтрует только по examIds — buildFilter больше ничего не читает, поведение сохранено. */
    async getFilteredResults(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: StudentResult[]; totalCount: number }> {
        const applyFilter = <Q extends { where: any }>(query: Q): Q =>
            filters.examIds && filters.examIds.length > 0 ? query.where("exam_id", "in", filters.examIds) : query;

        const sortColumn = this.mapSortColumn(sort.sortColumn);
        let query = applyFilter(pg.selectFrom("student_results").selectAll());
        query = query.orderBy(sortColumn, sort.sortDirection) as typeof query;

        const [rows, countRow] = await Promise.all([
            query.limit(pagination.size).offset(pagination.skip).execute(),
            applyFilter(pg.selectFrom("student_results"))
                .select(({ fn }) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        return { data: await this.attachRefs(rows), totalCount: Number(countRow.count) };
    }

    /**
     * Импорт результатов экзамена из Excel — тот же формат файла и та же логика, что в Mongo-версии
     * (см. комментарий в studentResult.service.ts): строки 4+ содержат данные, колонки определяются
     * позиционно, с ветвлением по классу (5+ vs младше). Не меняно ни на йоту — включая тот факт,
     * что вычисление maxLevel для НОВЫХ студентов использует `grade === 5` (не `>= 5`, как всё
     * остальное) — существующая особенность исходного кода, сохранена как есть.
     */
    async processStudentResultsFromExcel(filePath: string, examId: number): Promise<{
        processedData: StudentResult[];
        studentsWithoutTeacher: number[];
        incorrectStudentCodes: number[];
        studentsWithIncorrectResults: Array<{ code: number; reason: string }>;
    }> {
        try {
            const rows: any[] = readExcel(filePath);

            if (rows.length < 2) {
                throw new Error("Faylda kifayət qədər sətr yoxdur!");
            }

            const exam = await pg.selectFrom("exams").select(["id", "date"]).where("id", "=", examId).executeTakeFirst();
            if (!exam) {
                throw new Error("İmtahan tapılmadı!");
            }

            const examDate = new Date(exam.date);
            const month = examDate.getUTCMonth() + 1;
            const year = examDate.getUTCFullYear();

            const resultReadedData = rows.slice(3).map((row) => ({
                grade: Number(row[2]),
                studentCode: Number(row[3]),
                az: Number(row[2]) >= 5 ? Number(row[8]) : Number(row[7]),
                math: Number(row[2]) >= 5 ? Number(row[10]) : Number(row[8]),
                lifeKnowledge: Number(row[2]) >= 5 ? undefined : Number(row[9]),
                logic: Number(row[2]) >= 5 ? undefined : Number(row[10]),
                english: Number(row[2]) >= 5 ? Number(row[12]) : undefined,
                azCount: Number(row[2]) >= 5 ? Number(row[7]) : undefined,
                mathCount: Number(row[2]) >= 5 ? Number(row[9]) : undefined,
                englishCount: Number(row[2]) >= 5 ? Number(row[11]) : undefined,
                totalScore: Number(row[2]) >= 5 ? Number(row[13]) : Number(row[11]),
                level: Number(row[2]) >= 5 ? String(row[14]) : String(row[12]),
            }));

            const studentDataToInsert = rows.slice(3).map((row) => ({
                code: Number(row[3]),
                lastName: String(row[4]),
                firstName: String(row[5]),
                middleName: String(row[6]),
                grade: Number(row[2]),
                maxLevel: calculateParticipationScore(Number(row[2]) === 5 ? String(row[11]) : String(row[12])),
            }));

            const correctStudentDataToInsert = studentDataToInsert.filter((d) => d.code >= CODE_RANGES.STUDENT_MIN && d.code <= CODE_RANGES.STUDENT_MAX);
            const invalidStudentCodes = studentDataToInsert
                .filter((d) => d.code < CODE_RANGES.STUDENT_MIN || d.code > CODE_RANGES.STUDENT_MAX)
                .map((d) => d.code);

            const { students, studentsWithoutTeacher } = await this.processStudentResults(correctStudentDataToInsert);
            const studentByCode = new Map(students.map((s) => [s.code, s]));

            const filtredResults = resultReadedData.filter(
                (result) =>
                    studentByCode.has(result.studentCode) &&
                    result.totalScore === (result.az + result.math + (result.lifeKnowledge || 0) + (result.logic || 0) + (result.english || 0)) &&
                    result.totalScore > 0
            );

            const studentsWithIncorrectResults = resultReadedData
                .filter((result) => {
                    if (!studentByCode.has(result.studentCode)) return false;
                    const calculatedTotal = result.az + result.math + (result.lifeKnowledge || 0) + (result.logic || 0) + (result.english || 0);
                    return result.totalScore !== calculatedTotal || result.totalScore <= 0;
                })
                .map((result) => {
                    const calculatedTotal = result.az + result.math + (result.lifeKnowledge || 0) + (result.logic || 0) + (result.english || 0);
                    return {
                        code: result.studentCode,
                        reason:
                            result.totalScore <= 0
                                ? `Sıfır xal: şagird heç bir sual cavablandırmayıb`
                                : `Səhv cəm: ${calculatedTotal}, Faylda: ${result.totalScore}`,
                    };
                });

            const studentMaxLevelUpdates: Array<{ id: number; maxLevel: number }> = [];

            const resultsToInsert = filtredResults.map((result) => {
                const student = studentByCode.get(result.studentCode)!;
                const currentLevelScore = calculateParticipationScore(result.level);
                let developmentScore = 0;

                if (student.maxLevel !== undefined && student.maxLevel !== null) {
                    if (currentLevelScore > student.maxLevel) {
                        developmentScore = 10;
                        studentMaxLevelUpdates.push({ id: student.id, maxLevel: currentLevelScore });
                    }
                } else {
                    studentMaxLevelUpdates.push({ id: student.id, maxLevel: currentLevelScore });
                }

                return {
                    studentId: student.id,
                    examId,
                    grade: result.grade,
                    disciplines: {
                        az: Number(result.az) || 0,
                        math: Number(result.math) || 0,
                        lifeKnowledge: Number(result.lifeKnowledge) || undefined,
                        logic: Number(result.logic) || undefined,
                        english: Number(result.english) || undefined,
                    },
                    questionCounts: {
                        az: Number(result.azCount) || 0,
                        math: Number(result.mathCount) || 0,
                        english: Number(result.englishCount) || 0,
                    },
                    totalScore: result.totalScore,
                    level: result.level,
                    score: 1,
                    participationScore: currentLevelScore,
                    developmentScore,
                    month,
                    year,
                } as StudentResultCreate & { developmentScore: number };
            });

            for (const upd of studentMaxLevelUpdates) {
                await pg.updateTable("students").set({ max_level: upd.maxLevel }).where("id", "=", upd.id).execute();
            }

            await deleteFile(filePath).catch(() => {});

            const inserted: StudentResult[] = [];
            for (const result of resultsToInsert) {
                const row = await pg
                    .insertInto("student_results")
                    .values({ ...this.toColumns(result), development_score: result.developmentScore } as any)
                    .onConflict((oc) =>
                        oc.columns(["student_id", "exam_id"]).doUpdateSet({ ...this.toColumns(result), development_score: result.developmentScore })
                    )
                    .returningAll()
                    .executeTakeFirstOrThrow();
                inserted.push((await this.attachRefs([row]))[0]);
            }

            return {
                processedData: inserted,
                studentsWithoutTeacher,
                incorrectStudentCodes: [...new Set(invalidStudentCodes)],
                studentsWithIncorrectResults,
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    /**
     * Создаёт недостающих учеников (по коду), назначая учителя арифметикой кода — как и Mongo-версия.
     * Ученики, для которых учитель не резолвится, НЕ создаются (studentsWithoutTeacher) — то же поведение.
     */
    private async processStudentResults(
        studentDataToInsert: Array<{ code: number; lastName: string; firstName: string; middleName: string; grade: number; maxLevel: number }>
    ): Promise<{ students: Array<{ id: number; code: number; maxLevel: number | null }>; studentsWithoutTeacher: number[] }> {
        const studentCodes = studentDataToInsert.map((s) => s.code);
        const existingStudents = studentCodes.length > 0
            ? await pg.selectFrom("students").select(["id", "code", "max_level"]).where("code", "in", studentCodes).execute()
            : [];
        const existingCodes = new Set(existingStudents.map((s) => s.code));
        const newStudents = studentDataToInsert.filter((s) => !existingCodes.has(s.code));

        const resolved = await Promise.all(newStudents.map((s) => studentServicePg.assignTeacherToStudent(s.code)));

        const studentsWithTeacher: Array<StudentCreate & { code: number }> = [];
        const studentsWithoutTeacher: number[] = [];

        newStudents.forEach((s, i) => {
            const { teacherId, schoolId, districtId } = resolved[i];
            if (!teacherId) {
                studentsWithoutTeacher.push(s.code);
                return;
            }
            studentsWithTeacher.push({
                code: s.code, lastName: s.lastName, firstName: s.firstName, middleName: s.middleName,
                grade: s.grade, teacherId, schoolId, districtId, maxLevel: s.maxLevel,
            });
        });

        let newStudentsRows: Array<{ id: number; code: number; max_level: number | null }> = [];
        if (studentsWithTeacher.length > 0) {
            newStudentsRows = await pg
                .insertInto("students")
                .values(
                    studentsWithTeacher.map((s) => ({
                        code: s.code, last_name: s.lastName ?? null, first_name: s.firstName!, middle_name: s.middleName ?? null,
                        grade: s.grade ?? null, teacher_id: s.teacherId ?? null, school_id: s.schoolId ?? null, district_id: s.districtId ?? null,
                        max_level: s.maxLevel ?? null,
                    }))
                )
                .returning(["id", "code", "max_level"])
                .execute();
        }

        const allStudents = [
            ...existingStudents.map((s) => ({ id: s.id, code: s.code, maxLevel: s.max_level })),
            ...newStudentsRows.map((s) => ({ id: s.id, code: s.code, maxLevel: s.max_level })),
        ];

        return { students: allStudents, studentsWithoutTeacher };
    }

    /** Удаляет результаты экзамена и очищает `status` у затронутых учеников (два отдельных запроса, как в Mongo-версии). */
    async deleteResultsByExamId(examId: number): Promise<{ deletedCount: number }> {
        const affected = await pg.selectFrom("student_results").select("student_id").where("exam_id", "=", examId).execute();
        const studentIds = affected.map((r) => r.student_id);

        const deleteResult = await pg.deleteFrom("student_results").where("exam_id", "=", examId).executeTakeFirst();

        if (studentIds.length > 0) {
            await pg.updateTable("students").set({ status: null }).where("id", "in", studentIds).execute();
        }

        return { deletedCount: Number(deleteResult.numDeletedRows) };
    }

    /**
     * Одноразовый импорт исторических результатов из JSON (по полному имени ученика, без exam_id
     * в типичном случае) — см. importLegacyResultsFromJson в Mongo-версии, логика 1:1.
     */
    async importLegacyResultsFromJson(filePath: string): Promise<{
        inserted: number;
        skipped: number;
        errors: number;
        details: { skippedCodes: any[]; errorMessages: string[] };
    }> {
        let inserted = 0, skipped = 0, errors = 0;
        const skippedNames: string[] = [];
        const errorMessages: string[] = [];

        let records: any[];
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            records = JSON.parse(content);
        } finally {
            await deleteFile(filePath).catch(() => {});
        }

        const allStudents = await pg.selectFrom("students").select(["id", "last_name", "first_name", "middle_name"]).execute();
        const studentMap = new Map<string, { id: number }>();
        for (const student of allStudents) {
            const fullName = [student.last_name, student.first_name, student.middle_name]
                .map((part) => (part ?? "").trim())
                .filter(Boolean)
                .join(" ")
                .trim();
            if (fullName) studentMap.set(fullName, { id: student.id });
        }

        for (const record of records) {
            const { fullName, examId, ...resultData } = record;

            if (!fullName || typeof fullName !== "string") {
                skipped++;
                skippedNames.push("(no fullName)");
                continue;
            }

            const normalizedName = fullName.trim();
            const student = studentMap.get(normalizedName);
            if (!student) {
                skipped++;
                skippedNames.push(normalizedName);
                continue;
            }

            const examIdNum = examId ? parseInt(examId, 10) : null;
            if (examId && (examIdNum === null || isNaN(examIdNum))) {
                errors++;
                errorMessages.push(`${normalizedName}: invalid examId "${examId}"`);
                continue;
            }

            try {
                const values = {
                    student_id: student.id,
                    exam_id: examIdNum,
                    grade: resultData.grade ?? 0,
                    az: resultData.disciplines?.az ?? 0,
                    math: resultData.disciplines?.math ?? 0,
                    life_knowledge: resultData.disciplines?.lifeKnowledge ?? 0,
                    logic: resultData.disciplines?.logic ?? 0,
                    english: resultData.disciplines?.english ?? 0,
                    az_count: 0,
                    math_count: 0,
                    total_score: resultData.totalScore ?? 0,
                    score: resultData.score ?? 0,
                    participation_score: 0,
                    level: resultData.level ?? "",
                    status: resultData.status ?? null,
                    month: 0,
                    year: 2024,
                };

                const existing = await pg
                    .selectFrom("student_results")
                    .select("id")
                    .where("student_id", "=", student.id)
                    .where((eb) => (examIdNum === null ? eb("exam_id", "is", null) : eb("exam_id", "=", examIdNum)))
                    .executeTakeFirst();

                if (existing) {
                    await pg.updateTable("student_results").set(values).where("id", "=", existing.id).execute();
                } else {
                    await pg.insertInto("student_results").values(values).execute();
                }
                inserted++;
            } catch (err: any) {
                errors++;
                errorMessages.push(`${normalizedName}: ${err.message}`);
            }
        }

        return { inserted, skipped, errors, details: { skippedCodes: skippedNames, errorMessages } };
    }

    private mapSortColumn(column: string): "grade" | "total_score" | "level" | "month" | "year" | "id" {
        const map: Record<string, any> = { grade: "grade", totalScore: "total_score", level: "level", month: "month", year: "year", createdAt: "id" };
        return map[column] ?? "id";
    }

    private toColumns(data: Partial<StudentResultCreate>): Record<string, any> {
        const cols: Record<string, any> = {};
        if (data.studentId !== undefined) cols.student_id = data.studentId;
        if (data.examId !== undefined) cols.exam_id = data.examId;
        if (data.grade !== undefined) cols.grade = data.grade;
        if (data.disciplines !== undefined) {
            cols.az = data.disciplines.az;
            cols.math = data.disciplines.math;
            cols.life_knowledge = data.disciplines.lifeKnowledge ?? null;
            cols.logic = data.disciplines.logic ?? null;
            cols.english = data.disciplines.english ?? null;
        }
        if (data.questionCounts !== undefined) {
            cols.az_count = data.questionCounts.az;
            cols.math_count = data.questionCounts.math;
            cols.life_knowledge_count = data.questionCounts.lifeKnowledge ?? null;
            cols.logic_count = data.questionCounts.logic ?? null;
            cols.english_count = data.questionCounts.english ?? null;
        }
        if (data.totalScore !== undefined) cols.total_score = data.totalScore;
        if (data.level !== undefined) cols.level = data.level;
        if (data.participationScore !== undefined) cols.participation_score = data.participationScore;
        if (data.score !== undefined) cols.score = data.score;
        if (data.status !== undefined) cols.status = data.status;
        if (data.month !== undefined) cols.month = data.month;
        if (data.year !== undefined) cols.year = data.year;
        return cols;
    }

    private async attachRefs(rows: StudentResultRowRaw[]): Promise<StudentResult[]> {
        if (rows.length === 0) return [];
        const studentIds = [...new Set(rows.map((r) => r.student_id))];
        const examIds = [...new Set(rows.map((r) => r.exam_id).filter((id): id is number => id != null))];

        const [students, exams] = await Promise.all([
            pg.selectFrom("students").select(["id", "code", "last_name", "first_name", "middle_name"]).where("id", "in", studentIds).execute(),
            examIds.length > 0 ? pg.selectFrom("exams").select(["id", "code", "name", "date"]).where("id", "in", examIds).execute() : Promise.resolve([]),
        ]);

        const studentById = new Map(students.map((s) => [s.id, s]));
        const examById = new Map(exams.map((e) => [e.id, e]));

        return rows.map((row) => {
            const student = studentById.get(row.student_id);
            const exam = row.exam_id != null ? examById.get(row.exam_id) : undefined;
            return {
                id: row.id,
                studentId: row.student_id,
                examId: row.exam_id,
                grade: row.grade,
                disciplines: { az: row.az, math: row.math, lifeKnowledge: row.life_knowledge, logic: row.logic, english: row.english },
                questionCounts: { az: row.az_count, math: row.math_count, lifeKnowledge: row.life_knowledge_count, logic: row.logic_count, english: row.english_count },
                totalScore: row.total_score,
                level: row.level,
                score: row.score,
                participationScore: row.participation_score,
                developmentScore: row.development_score,
                studentOfTheMonthScore: row.student_of_the_month_score,
                republicWideStudentOfTheMonthScore: row.republic_wide_student_of_the_month_score,
                status: row.status,
                month: row.month,
                year: row.year,
                student: student
                    ? { id: student.id, code: student.code, lastName: student.last_name, firstName: student.first_name, middleName: student.middle_name }
                    : undefined,
                exam: row.exam_id != null ? (exam ? { id: exam.id, code: exam.code, name: exam.name, date: exam.date } : null) : undefined,
            };
        });
    }
}

export const studentResultServicePg = new StudentResultServicePg();
