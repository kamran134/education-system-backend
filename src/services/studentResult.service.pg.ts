import fs from "fs";
import { Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { studentServicePg, StudentCreate } from "./student.service.pg";
import { examTypeServicePg } from "./examType.service.pg";
import { levelScaleServicePg, maxPriorBandRank } from "./levelScale.service.pg";
import { subjectServicePg } from "./subject.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions } from "../types/common.types";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { CODE_RANGES } from "../utils/entity-codes.const";

// SAGIRD_FULLNAME_TASK.md §5: заголовок col 2 файла импорта, распознаваемый как ОДНА колонка ФИО
// (а не первая из трёх legacy-колонок Soyadı/Adı/Ata adı). "Soyadı, adı, ata adı" — заголовок,
// который генерирует resultTemplate.service.ts; "Şagirdin adı" — синоним, который заказчик
// использует в части уже существующих у районов файлов. Сравнение регистронезависимое.
const SINGLE_FULLNAME_HEADERS = new Set(["soyadı, adı, ata adı", "şagirdin adı"]);

/**
 * Баллы по одному предмету одного результата. Заменяет пятиколоночный StudentResultDisciplines
 * (IMTAHAN_NOVLERI_TASK.md §4-§7, шаг 2): произвольный набор предметов на тип экзамена, столбцами
 * такое не выразить. maxQuestions — не хранится на строке, а подтягивается из конфига секции
 * (exam_type_section_subjects) на чтении — тот же предмет в другой секции может иметь другой лимит.
 */
export interface StudentResultSubjectScoreInput {
    subjectCode: string;
    score: number;
    questionCount?: number | null;
}

export interface StudentResultSubjectScoreRow {
    subjectCode: string;
    nameAz: string;
    score: number;
    questionCount: number | null;
    maxQuestions: number | null;
}

export interface StudentRef {
    id: number;
    code: number;
    fullname: string;
}

export interface ExamRef {
    id: number;
    name: string;
    date: Date;
}

export interface StudentResult {
    id: number;
    studentId: number;
    examId: number | null;
    examTypeId: number | null;
    sectionId: number | null;
    levelScaleId: number | null;
    grade: number;
    disciplines: StudentResultSubjectScoreRow[];
    totalScore: number;
    maxQuestions: number | null;
    scorePercent: number | null;
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

/**
 * Вход ручного создания/правки результата (result-editing-dialog на фронте). `disciplines` —
 * баллы по предметам; total_score/score_percent/level/participation_score сервер считает сам
 * из конфига секции экзамена и шкалы типа (§5 ТЗ: "расчёт... на бэке" — единственный источник
 * истины, тот же путь, что использует парсер Excel ниже).
 */
export interface StudentResultCreate {
    studentId: number;
    examId?: number | null;
    grade: number;
    disciplines: StudentResultSubjectScoreInput[];
    status?: string | null;
    month: number;
    year: number;
}

type StudentResultRowRaw = {
    id: number; student_id: number; exam_id: number | null; grade: number;
    exam_type_id: number | null; section_id: number | null; level_scale_id: number | null;
    max_questions: number | null; score_percent: number | null;
    total_score: number; level: string; score: number; participation_score: number;
    development_score: number | null; student_of_the_month_score: number | null; republic_wide_student_of_the_month_score: number | null;
    status: string | null; month: number; year: number;
};

interface SectionConfig {
    sectionId: number;
    subjects: Map<string, { maxQuestions: number; nameAz: string; sortOrder: number }>;
    totalMaxQuestions: number;
}

/**
 * Postgres-версия StudentResultService — см. studentResult.service.ts (Mongo) для сравнения.
 *
 * **Не перенесены (мёртвый код, подтверждено grep 04.08.2026):** `markAllDevelopingStudents`,
 * `markTopStudents`, `markTopStudentsRepublic` — см. историю до шага 2, не изменилось.
 * `createBulk` и 4 отдельных экспорта `deleteStudentResultsBy*` — по-прежнему не вызываются.
 *
 * **Шаг 2 (IMTAHAN_NOVLERI_TASK.md §4-§7):** позиционный парсер Excel с веткой по классу
 * (`row[7]`/`row[8]`, `grade >= 5`) заменён парсером по заголовкам — предмет опознаётся по
 * `subjects.name_az`, набор предметов и лимиты берутся из `exam_type_section_subjects` секции,
 * в которую попадает класс строки. `total_score`/`score_percent`/`level`/`participation_score`
 * считаются здесь же, единым путём для ручного создания/правки результата (`create`/`update`)
 * и для массового импорта (`processStudentResultsFromExcel`) — `computeScoreSummary` ниже.
 * Баллы по предметам хранятся в `student_result_subject_scores`, а не в пяти колонках
 * `student_results` (те остаются NULL у всех новых строк — легаси, снос в 026).
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
        const examTypeId = await this.resolveExamTypeId(data.examId);
        const summary = await this.computeScoreSummary(examTypeId, data.grade, data.disciplines);

        const row = await pg.transaction().execute(async (trx) => {
            const inserted = await trx
                .insertInto("student_results")
                .values({
                    student_id: data.studentId,
                    exam_id: data.examId ?? null,
                    grade: data.grade,
                    exam_type_id: examTypeId,
                    section_id: summary.sectionId,
                    level_scale_id: summary.levelScaleId,
                    max_questions: summary.maxQuestions,
                    score_percent: summary.scorePercent,
                    total_score: summary.totalScore,
                    level: summary.level,
                    participation_score: summary.participationScore,
                    score: 1,
                    status: data.status ?? null,
                    month: data.month,
                    year: data.year,
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            await this.replaceSubjectScores(trx, inserted.id, summary.subjectRows);
            return inserted;
        });

        return (await this.attachRefs([row]))[0];
    }

    async update(id: number, data: Partial<StudentResultCreate>): Promise<StudentResult> {
        const current = await pg.selectFrom("student_results").selectAll().where("id", "=", id).executeTakeFirst();
        if (!current) throw new Error("Student result not found");

        const grade = data.grade ?? current.grade;
        const examId = data.examId !== undefined ? data.examId : current.exam_id;

        let scoreFields: Record<string, any> = {};
        let subjectRows: Array<{ subjectCode: string; score: number; questionCount: number | null }> | null = null;

        if (data.disciplines !== undefined) {
            const examTypeId = await this.resolveExamTypeId(examId);
            const summary = await this.computeScoreSummary(examTypeId, grade, data.disciplines);
            scoreFields = {
                exam_type_id: examTypeId,
                section_id: summary.sectionId,
                level_scale_id: summary.levelScaleId,
                max_questions: summary.maxQuestions,
                score_percent: summary.scorePercent,
                total_score: summary.totalScore,
                level: summary.level,
                participation_score: summary.participationScore,
            };
            subjectRows = summary.subjectRows;
        }

        const row = await pg.transaction().execute(async (trx) => {
            const updated = await trx
                .updateTable("student_results")
                .set({
                    ...(data.studentId !== undefined && { student_id: data.studentId }),
                    ...(data.examId !== undefined && { exam_id: data.examId }),
                    ...(data.grade !== undefined && { grade: data.grade }),
                    ...scoreFields,
                    ...(data.status !== undefined && { status: data.status }),
                    ...(data.month !== undefined && { month: data.month }),
                    ...(data.year !== undefined && { year: data.year }),
                })
                .where("id", "=", id)
                .returningAll()
                .executeTakeFirst();

            if (!updated) throw new Error("Student result not found");
            if (subjectRows) await this.replaceSubjectScores(trx, id, subjectRows);
            return updated;
        });

        return (await this.attachRefs([row]))[0];
    }

    /** ON DELETE CASCADE (student_result_subject_scores.result_id) убирает баллы по предметам сам. */
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
     * Импорт результатов экзамена из Excel (IMTAHAN_NOVLERI_TASK.md §7). Формат: строка 1 —
     * заголовки (`Şagird kodu | Sinif | Soyad | Ad | Ata adı | <Predmet> | <Predmet> (sual sayı) | ...`,
     * ровно то, что генерирует `GET /exams/:id/results-template.xlsx`), данные — со строки 2.
     * Предмет опознаётся по `name_az`, набор и лимиты — из секции, в которую попадает класс
     * строки. total_score/score_percent/level/participation_score считает сервер.
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
                throw this.importError("Faylda kifayət qədər sətr yoxdur!");
            }

            const exam = await pg.selectFrom("exams").select(["id", "date", "exam_type_id"]).where("id", "=", examId).executeTakeFirst();
            if (!exam) throw this.importError("İmtahan tapılmadı!");

            const examType = await examTypeServicePg.findById(exam.exam_type_id);
            if (!examType) throw this.importError("İmtahan növü tapılmadı!");

            const examDate = new Date(exam.date);
            const month = examDate.getUTCMonth() + 1;
            const year = examDate.getUTCFullYear();
            // IMTAHAN_NOVLERI_TASK.md §15: то же определение учебного года, что использует
            // markDevelopingStudents() (stats.service.pg.ts) — единый экзамен, поэтому считается
            // один раз для всего импорта, а не на строку.
            const academicYearStart = month >= 9 ? year : year - 1;

            const subjects = await subjectServicePg.findAll();
            const headerRow: any[] = Array.isArray(rows[0]) ? rows[0] : [];
            // SAGIRD_FULLNAME_TASK.md §5: заголовок col 2 решает формат имени — одна колонка ФИО
            // (шаблон с шага 3, resultTemplate.service.ts) или три legacy-колонки (файлы, которые
            // уже лежат у районов с шага 2). Предметы начинаются сразу после имени — col 3 в
            // первом случае, col 5 (как раньше) во втором. Если файл почему-то содержит оба
            // варианта — побеждает одна колонка, о расхождении не ругаемся (§5 ТЗ).
            const nameHeader = String(headerRow[2] ?? "").trim().toLocaleLowerCase("az");
            const isSingleNameColumn = SINGLE_FULLNAME_HEADERS.has(nameHeader);
            const subjectsStartIdx = isSingleNameColumn ? 3 : 5;

            const subjectColumns = this.parseHeaderColumns(headerRow, subjects, subjectsStartIdx);
            if (subjectColumns.filter((c) => !c.isCount).length === 0) {
                throw this.importError("Fayl başlıqlarında fənn sütunları tapılmadı");
            }
            const countColByCode = new Map(subjectColumns.filter((c) => c.isCount).map((c) => [c.subjectCode, c.colIdx]));
            const scoreColumns = subjectColumns.filter((c) => !c.isCount);

            const dataRows = rows.slice(1);
            const sectionConfigByGrade = new Map<number, SectionConfig | null>();

            const invalidStudentCodes: number[] = [];
            const studentsWithIncorrectResults: Array<{ code: number; reason: string }> = [];
            const parsedRows: Array<{
                grade: number; studentCode: number; fullname: string;
                subjectScores: Array<{ subjectCode: string; score: number; questionCount: number | null }>;
                totalScore: number; sectionId: number; maxQuestions: number;
            }> = [];

            for (const row of dataRows) {
                if (!Array.isArray(row) || row.every((c) => c == null || String(c).trim() === "")) continue;

                const code = Number(row[0]);
                const grade = Number(row[1]);

                if (!code || isNaN(code) || code < CODE_RANGES.STUDENT_MIN || code > CODE_RANGES.STUDENT_MAX) {
                    invalidStudentCodes.push(code);
                    continue;
                }
                if (!grade || isNaN(grade)) {
                    studentsWithIncorrectResults.push({ code, reason: "Sinif düzgün deyil" });
                    continue;
                }

                let config = sectionConfigByGrade.get(grade);
                if (config === undefined) {
                    config = await this.resolveSectionConfig(exam.exam_type_id, grade);
                    sectionConfigByGrade.set(grade, config);
                }
                if (config === null) {
                    studentsWithIncorrectResults.push({ code, reason: `${grade}-ci sinif üçün bu imtahan növündə bölmə tapılmadı` });
                    continue;
                }

                let hasError = false;
                let totalScore = 0;
                const subjectScores: Array<{ subjectCode: string; score: number; questionCount: number | null }> = [];

                for (const col of scoreColumns) {
                    const cfg = config.subjects.get(col.subjectCode);
                    if (!cfg) {
                        // Структурное несоответствие шаблона и конфига секции — не за что зацепиться
                        // построчно, весь импорт останавливается (§7 ТЗ).
                        throw this.importError(`"${col.nameAz}" fənni ${grade}-ci sinif bölməsinin tərkibinə daxil deyil`);
                    }

                    const rawScore = row[col.colIdx];
                    const score = rawScore == null || String(rawScore).trim() === "" ? 0 : Number(rawScore);
                    if (isNaN(score)) {
                        studentsWithIncorrectResults.push({ code, reason: `${cfg.nameAz}: bal ədəd deyil ("${rawScore}")` });
                        hasError = true;
                        break;
                    }
                    if (score > cfg.maxQuestions) {
                        studentsWithIncorrectResults.push({ code, reason: `${cfg.nameAz}: bal (${score}) sual sayından (${cfg.maxQuestions}) çoxdur` });
                        hasError = true;
                        break;
                    }

                    const countColIdx = countColByCode.get(col.subjectCode);
                    const rawCount = countColIdx !== undefined ? row[countColIdx] : null;
                    const questionCount = rawCount != null && String(rawCount).trim() !== "" ? Number(rawCount) : null;

                    totalScore += score;
                    subjectScores.push({ subjectCode: col.subjectCode, score, questionCount });
                }

                if (hasError) continue;

                if (totalScore <= 0) {
                    studentsWithIncorrectResults.push({ code, reason: "Sıfır xal: şagird heç bir sual cavablandırmayıb" });
                    continue;
                }

                const fullname = isSingleNameColumn
                    ? String(row[2] ?? "").trim()
                    : [row[2], row[3], row[4]].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");

                parsedRows.push({
                    grade,
                    studentCode: code,
                    fullname,
                    subjectScores,
                    totalScore,
                    sectionId: config.sectionId,
                    maxQuestions: config.totalMaxQuestions,
                });
            }

            const studentDataToInsert = parsedRows.map((r) => ({
                code: r.studentCode, fullname: r.fullname,
                grade: r.grade, maxLevel: null as number | null,
            }));
            const { students, studentsWithoutTeacher } = await this.processStudentResults(studentDataToInsert);
            const studentByCode = new Map(students.map((s) => [s.code, s]));

            const inserted: StudentResult[] = [];
            const studentMaxLevelUpdates: Array<{ id: number; maxLevel: number }> = [];

            for (const r of parsedRows) {
                const student = studentByCode.get(r.studentCode);
                if (!student) continue; // studentsWithoutTeacher — уже учтено

                const scorePercent = r.maxQuestions > 0 ? (r.totalScore / r.maxQuestions) * 100 : 0;
                const band = await levelScaleServicePg.resolveBand(examType.levelScaleId, scorePercent);

                // IMTAHAN_NOVLERI_TASK.md §15: developmentScore больше НЕ сравнивается со
                // students.max_level (lifetime, без разбивки по типу экзамена — очки разных типов
                // смешивались бы, решение №6 §2 ТЗ: ученик мог дорасти до C на базовом типе, взять
                // A на другом типе, вернуться на базовый и вырасти до B — не получая награду,
                // потому что 4 < 5). Критерий — тот же, что в markDevelopingStudents()
                // (stats.service.pg.ts): максимальный ранг бэнда среди БОЛЕЕ РАННИХ результатов
                // ЭТОГО ЖЕ ученика по ЭТОМУ ЖЕ типу экзамена в этом же учебном году.
                const priorMaxRank = await maxPriorBandRank(student.id, exam.exam_type_id, academicYearStart, examDate);
                const developmentScore = priorMaxRank !== null && band.rank > priorMaxRank ? 10 : 0;

                // students.max_level — ЛЕГАСИ (§15): для решений (development_score, levelStatistics)
                // больше не читается нигде в src/, пишется только для обратной совместимости колонки.
                // Подлежит сносу вместе с миграцией 026 — тогда убрать и эту запись.
                if (student.maxLevel === undefined || student.maxLevel === null || band.participationScore > student.maxLevel) {
                    studentMaxLevelUpdates.push({ id: student.id, maxLevel: band.participationScore });
                }

                const scorePercentRounded = Number(scorePercent.toFixed(3));

                const row = await pg.transaction().execute(async (trx) => {
                    const upserted = await trx
                        .insertInto("student_results")
                        .values({
                            student_id: student.id, exam_id: examId, grade: r.grade,
                            exam_type_id: exam.exam_type_id, section_id: r.sectionId, level_scale_id: examType.levelScaleId,
                            max_questions: r.maxQuestions, score_percent: scorePercentRounded,
                            total_score: r.totalScore, level: band.code, participation_score: band.participationScore,
                            development_score: developmentScore, score: 1, month, year,
                        })
                        .onConflict((oc) =>
                            oc.columns(["student_id", "exam_id"]).doUpdateSet({
                                grade: r.grade, exam_type_id: exam.exam_type_id, section_id: r.sectionId,
                                level_scale_id: examType.levelScaleId, max_questions: r.maxQuestions,
                                score_percent: scorePercentRounded, total_score: r.totalScore, level: band.code,
                                participation_score: band.participationScore, development_score: developmentScore,
                            })
                        )
                        .returningAll()
                        .executeTakeFirstOrThrow();

                    await this.replaceSubjectScores(trx, upserted.id, r.subjectScores);
                    return upserted;
                });

                inserted.push((await this.attachRefs([row]))[0]);
            }

            for (const upd of studentMaxLevelUpdates) {
                await pg.updateTable("students").set({ max_level: upd.maxLevel }).where("id", "=", upd.id).execute();
            }

            await deleteFile(filePath).catch(() => {});

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
     * Создаёт недостающих учеников (по коду), назначая учителя арифметикой кода — как и раньше.
     * Ученики, для которых учитель не резолвится, НЕ создаются (studentsWithoutTeacher).
     * maxLevel у новых студентов теперь неизвестен на момент создания (шаг 2 больше не читает
     * level из файла — его считает сервер уже после того, как студент создан), поэтому
     * передаётся null; вызывающий код (processStudentResultsFromExcel) сам проставляет
     * students.max_level через studentMaxLevelUpdates, как и раньше.
     */
    private async processStudentResults(
        studentDataToInsert: Array<{ code: number; fullname: string; grade: number; maxLevel: number | null }>
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
                code: s.code, fullname: s.fullname,
                grade: s.grade, teacherId, schoolId, districtId, maxLevel: s.maxLevel ?? undefined,
            });
        });

        let newStudentsRows: Array<{ id: number; code: number; max_level: number | null }> = [];
        if (studentsWithTeacher.length > 0) {
            newStudentsRows = await pg
                .insertInto("students")
                .values(
                    studentsWithTeacher.map((s) => ({
                        code: s.code, fullname: s.fullname,
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

    /** Удаляет результаты экзамена и очищает `status` у затронутых учеников. Баллы по предметам
     *  (student_result_subject_scores) уходят сами через ON DELETE CASCADE. */
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
     * Одноразовый импорт исторических результатов из JSON — НЕ трогается по требованию ТЗ §7
     * ("Легаси-импорт POST /student-results/import-json не трогаем"). Единственное добавление:
     * exam_type_id (базовый тип) и level_scale_id (isim_percent) проставляются на вставке —
     * без них у новых через этот путь строк не работал бы composite FK на level_scale_bands
     * (level_scale_id NULL => FK не проверяется вовсе, а не "проверяется как раньше через
     * levels"), и они выпадали бы из всего, что читает student_results по типу экзамена в
     * будущих шагах. Логика сопоставления по ФИО, баллы, статус — не изменены.
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

        const [allStudents, baseType, levelScale] = await Promise.all([
            // fullname, а не склейка трёх легаси-колонок (SAGIRD_FULLNAME_TASK.md): значение
            // побайтно то же самое — 025b заполнила fullname ровно этой склейкой, — но так
            // здесь не остаётся последнего живого читателя last_name/first_name/middle_name,
            // и миграция сноса этих колонок не потребует правок в этом файле.
            pg.selectFrom("students").select(["id", "fullname"]).execute(),
            pg.selectFrom("exam_types").select("id").where("is_base", "=", true).executeTakeFirstOrThrow(),
            pg.selectFrom("level_scales").select("id").where("code", "=", "isim_percent").executeTakeFirstOrThrow(),
        ]);
        const studentMap = new Map<string, { id: number }>();
        for (const student of allStudents) {
            const fullName = (student.fullname ?? "").trim();
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
                    exam_type_id: baseType.id,
                    level_scale_id: levelScale.id,
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

    /** Резолвит exam_type_id для ручного создания/правки результата: из exams по examId, либо
     *  базовый тип (is_base = true), если examId не указан — тот же паттерн, что и backfill
     *  024_student_result_subject_scores.sql для строк без exam_id. */
    private async resolveExamTypeId(examId: number | null | undefined): Promise<number> {
        if (examId != null) {
            const exam = await pg.selectFrom("exams").select("exam_type_id").where("id", "=", examId).executeTakeFirst();
            if (exam) return exam.exam_type_id;
        }
        const base = await pg.selectFrom("exam_types").select("id").where("is_base", "=", true).executeTakeFirstOrThrow();
        return base.id;
    }

    /** Секция типа экзамена, в которую попадает класс, + её конфиг предметов. `null`, если ни
     *  одна секция не покрывает этот класс (данные и должны быть возможны без исключения —
     *  вызывающий код решает, ошибка ли это построчная или на весь импорт). Бросает исключение,
     *  если секция найдена, но в ней НЕ настроено ни одного предмета (§3/§7 ТЗ) — делить на
     *  ноль нельзя, а это состояние (свежесозданный тип/секция "5-11 sinif") штатное. */
    private async resolveSectionConfig(examTypeId: number, grade: number): Promise<SectionConfig | null> {
        const section = await pg
            .selectFrom("exam_type_sections")
            .select(["id"])
            .where("exam_type_id", "=", examTypeId)
            .where("grade_from", "<=", grade)
            .where("grade_to", ">=", grade)
            .executeTakeFirst();
        if (!section) return null;

        const subjectRows = await pg
            .selectFrom("exam_type_section_subjects as ss")
            .innerJoin("subjects as s", "s.code", "ss.subject_code")
            .select(["ss.subject_code", "ss.max_questions", "s.name_az", "ss.sort_order"])
            .where("ss.section_id", "=", section.id)
            .execute();

        if (subjectRows.length === 0) {
            throw this.importError("Bu sinif qrupu üçün fənlər təyin edilməyib");
        }

        const subjects = new Map(
            subjectRows.map((r) => [r.subject_code, { maxQuestions: r.max_questions, nameAz: r.name_az, sortOrder: r.sort_order }])
        );
        const totalMaxQuestions = subjectRows.reduce((sum, r) => sum + r.max_questions, 0);

        return { sectionId: section.id, subjects, totalMaxQuestions };
    }

    /** Общий расчёт для ручного create/update одного результата: валидирует предметы против
     *  конфига секции, считает total_score/score_percent/level/participation_score. Тот же
     *  принцип, что использует построчный разбор Excel-импорта, но для одного результата и с
     *  исключением вместо построчного пропуска (единичная правка — либо валидна целиком, либо нет). */
    private async computeScoreSummary(
        examTypeId: number,
        grade: number,
        disciplines: StudentResultSubjectScoreInput[]
    ): Promise<{
        sectionId: number;
        levelScaleId: number;
        maxQuestions: number;
        totalScore: number;
        scorePercent: number;
        level: string;
        participationScore: number;
        subjectRows: Array<{ subjectCode: string; score: number; questionCount: number | null }>;
    }> {
        const config = await this.resolveSectionConfig(examTypeId, grade);
        if (!config) {
            throw this.importError(`${grade}-ci sinif üçün bu imtahan növündə bölmə tapılmadı`);
        }

        let totalScore = 0;
        const subjectRows: Array<{ subjectCode: string; score: number; questionCount: number | null }> = [];
        for (const d of disciplines) {
            const cfg = config.subjects.get(d.subjectCode);
            if (!cfg) {
                throw this.importError(`"${d.subjectCode}" fənni bu bölmənin tərkibinə daxil deyil`);
            }
            if (d.score > cfg.maxQuestions) {
                throw this.importError(`${cfg.nameAz}: bal (${d.score}) sual sayından (${cfg.maxQuestions}) çoxdur`);
            }
            totalScore += d.score;
            subjectRows.push({ subjectCode: d.subjectCode, score: d.score, questionCount: d.questionCount ?? null });
        }

        const examType = await examTypeServicePg.findById(examTypeId);
        if (!examType) throw this.importError("İmtahan növü tapılmadı");

        const scorePercent = config.totalMaxQuestions > 0 ? (totalScore / config.totalMaxQuestions) * 100 : 0;
        const band = await levelScaleServicePg.resolveBand(examType.levelScaleId, scorePercent);

        return {
            sectionId: config.sectionId,
            levelScaleId: examType.levelScaleId,
            maxQuestions: config.totalMaxQuestions,
            totalScore,
            scorePercent: Number(scorePercent.toFixed(3)),
            level: band.code,
            participationScore: band.participationScore,
            subjectRows,
        };
    }

    private async replaceSubjectScores(
        trx: Transaction<DB>,
        resultId: number,
        subjectRows: Array<{ subjectCode: string; score: number; questionCount: number | null }>
    ): Promise<void> {
        await trx.deleteFrom("student_result_subject_scores").where("result_id", "=", resultId).execute();
        if (subjectRows.length > 0) {
            await trx
                .insertInto("student_result_subject_scores")
                .values(subjectRows.map((r) => ({ result_id: resultId, subject_code: r.subjectCode, score: r.score, question_count: r.questionCount })))
                .execute();
        }
    }

    /** Заголовки строки 1 шаблона: col 0-1 фиксированы позиционно (код/класс), col 2..startIdx-1 —
     *  имя ученика (одна колонка ФИО ИЛИ три legacy-колонки, см. SINGLE_FULLNAME_HEADERS/startIdx
     *  в processStudentResultsFromExcel), col startIdx+ — предметы, опознаются по name_az или
     *  "<name_az> (sual sayı)". Неопознанный заголовок — исключение с указанием колонки и
     *  текста (§7 ТЗ: "неизвестный заголовок — ошибка импорта, а не молчаливый пропуск"). */
    private parseHeaderColumns(
        headerRow: any[],
        subjects: Array<{ code: string; nameAz: string }>,
        startIdx: number
    ): Array<{ colIdx: number; subjectCode: string; nameAz: string; isCount: boolean }> {
        const byName = new Map(subjects.map((s) => [s.nameAz.trim(), s.code]));
        const countSuffix = " (sual sayı)";
        const columns: Array<{ colIdx: number; subjectCode: string; nameAz: string; isCount: boolean }> = [];

        for (let i = startIdx; i < headerRow.length; i++) {
            const raw = headerRow[i];
            const text = raw == null ? "" : String(raw).trim();
            if (text === "") continue;

            if (text.endsWith(countSuffix)) {
                const subjectName = text.slice(0, -countSuffix.length).trim();
                const code = byName.get(subjectName);
                if (!code) throw this.importError(`Naməlum sütun (${this.colLabel(i)}): "${text}"`);
                columns.push({ colIdx: i, subjectCode: code, nameAz: subjectName, isCount: true });
                continue;
            }

            const code = byName.get(text);
            if (!code) throw this.importError(`Naməlum sütun (${this.colLabel(i)}): "${text}"`);
            columns.push({ colIdx: i, subjectCode: code, nameAz: text, isCount: false });
        }

        return columns;
    }

    /** 0-based индекс колонки -> буквенное обозначение (A, B, ..., Z, AA, ...) для сообщений об ошибках. */
    private colLabel(idx: number): string {
        let n = idx + 1;
        let label = "";
        while (n > 0) {
            const rem = (n - 1) % 26;
            label = String.fromCharCode(65 + rem) + label;
            n = Math.floor((n - 1) / 26);
        }
        return label;
    }

    private importError(message: string): Error {
        const err: any = new Error(message);
        err.status = 400;
        return err;
    }

    private mapSortColumn(column: string): "grade" | "total_score" | "level" | "month" | "year" | "id" {
        const map: Record<string, any> = { grade: "grade", totalScore: "total_score", level: "level", month: "month", year: "year", createdAt: "id" };
        return map[column] ?? "id";
    }

    private async attachRefs(rows: StudentResultRowRaw[]): Promise<StudentResult[]> {
        if (rows.length === 0) return [];
        const resultIds = rows.map((r) => r.id);
        const studentIds = [...new Set(rows.map((r) => r.student_id))];
        const examIds = [...new Set(rows.map((r) => r.exam_id).filter((id): id is number => id != null))];
        const sectionIds = [...new Set(rows.map((r) => r.section_id).filter((id): id is number => id != null))];

        const [students, exams, subjectScoreRows, sectionSubjectRows] = await Promise.all([
            pg.selectFrom("students").select(["id", "code", "fullname"]).where("id", "in", studentIds).execute(),
            examIds.length > 0 ? pg.selectFrom("exams").select(["id", "name", "date"]).where("id", "in", examIds).execute() : Promise.resolve([]),
            pg
                .selectFrom("student_result_subject_scores as srs")
                .innerJoin("subjects as s", "s.code", "srs.subject_code")
                .select(["srs.result_id", "srs.subject_code", "s.name_az", "srs.score", "srs.question_count"])
                .where("srs.result_id", "in", resultIds)
                .execute(),
            sectionIds.length > 0
                ? pg
                      .selectFrom("exam_type_section_subjects")
                      .select(["section_id", "subject_code", "max_questions"])
                      .where("section_id", "in", sectionIds)
                      .execute()
                : Promise.resolve([]),
        ]);

        const studentById = new Map(students.map((s) => [s.id, s]));
        const examById = new Map(exams.map((e) => [e.id, e]));
        const maxQuestionsBySectionSubject = new Map(sectionSubjectRows.map((r) => [`${r.section_id}:${r.subject_code}`, r.max_questions]));

        return rows.map((row) => {
            const student = studentById.get(row.student_id);
            const exam = row.exam_id != null ? examById.get(row.exam_id) : undefined;
            const disciplines: StudentResultSubjectScoreRow[] = subjectScoreRows
                .filter((s) => s.result_id === row.id)
                .map((s) => ({
                    subjectCode: s.subject_code,
                    nameAz: s.name_az,
                    score: s.score,
                    questionCount: s.question_count,
                    maxQuestions: row.section_id != null ? maxQuestionsBySectionSubject.get(`${row.section_id}:${s.subject_code}`) ?? null : null,
                }));

            return {
                id: row.id,
                studentId: row.student_id,
                examId: row.exam_id,
                examTypeId: row.exam_type_id,
                sectionId: row.section_id,
                levelScaleId: row.level_scale_id,
                grade: row.grade,
                disciplines,
                totalScore: row.total_score,
                maxQuestions: row.max_questions,
                scorePercent: row.score_percent,
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
                    ? { id: student.id, code: student.code, fullname: student.fullname }
                    : undefined,
                exam: row.exam_id != null ? (exam ? { id: exam.id, name: exam.name, date: exam.date } : null) : undefined,
            };
        });
    }
}

export const studentResultServicePg = new StudentResultServicePg();
