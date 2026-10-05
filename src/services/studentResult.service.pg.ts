import fs from "fs";
import { Transaction } from "kysely";
import { pg } from "../config/pg";
import { DB } from "../types/db";
import { studentServicePg, StudentCreate } from "./student.service.pg";
import { examTypeServicePg } from "./examType.service.pg";
import { levelScaleServicePg, maxPriorBandRanks } from "./levelScale.service.pg";
import { subjectServicePg } from "./subject.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions } from "../types/common.types";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { CODE_DIVISORS, CODE_RANGES } from "../utils/entity-codes.const";

// SAGIRD_FULLNAME_TASK.md §5: заголовок col 2 файла импорта, распознаваемый как ОДНА колонка ФИО
// (а не первая из трёх legacy-колонок Soyadı/Adı/Ata adı). "Soyadı, adı, ata adı" — заголовок,
// который генерирует resultTemplate.service.ts; "Şagirdin adı" — синоним, который заказчик
// использует в части уже существующих у районов файлов. Сравнение регистронезависимое.
const SINGLE_FULLNAME_HEADERS = new Set(["soyadı, adı, ata adı", "şagirdin adı"]);

/** Заголовок для сравнения: регистр (по-азербайджански) и пробелы не важны — "riyaziyyat " == "Riyaziyyat". */
function normalizeHeader(value: unknown): string {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("az");
}

/** Построчная проблема импорта; `row` — номер строки в Excel (заголовок — строка 1). */
export interface ImportRowIssue {
    row: number;
    code: number | null;
    reason: string;
}

/** Число вопросов предмета в строке отличается от самого частого по файлу — не ошибка, предупреждение. */
export interface QuestionCountWarning {
    row: number;
    code: number;
    subject: string;
    count: number;
    usual: number;
}

/**
 * One line of the downloadable error report (frontend builds an .xlsx from these): every problem
 * the import found, with the Excel row, the column (letter + header text), the student and the cell
 * value — so a district can fix its file without the dialog open. Old per-kind lists stay alongside
 * for the dialog.
 */
export interface ImportIssue {
    row: number;
    column: string | null;      // Excel column letter, e.g. "E"
    columnName: string | null;  // header text of that column, e.g. "Riyaziyyat"
    code: number | null;
    fullname: string | null;
    value: string | null;       // the offending cell value as written in the file
    kind: string;               // short Azerbaijani category: "Şagird kodu", "Bal", "Sual sayı", ...
    message: string;
    severity: "error" | "warning";
}

export interface StudentResultImportSummary {
    processedCount: number;
    sectionName: string | null;
    studentsWithoutTeacher: number[];
    incorrectStudentCodes: number[];
    studentsWithIncorrectResults: ImportRowIssue[];
    questionCountWarnings: QuestionCountWarning[];
    issues: ImportIssue[];
}

/**
 * Баллы по одному предмету одного результата. Заменяет пятиколоночный StudentResultDisciplines
 * (IMTAHAN_NOVLERI_TASK.md §4-§7, шаг 2): произвольный набор предметов на тип экзамена, столбцами
 * такое не выразить. questionCount обязателен (§16): конфиг секции больше не задаёт числа
 * вопросов вовсе (тип/секция определяют только СОСТАВ предметов) — знаменатель процента считается
 * по этому полю, взятому из файла или ручного ввода, отдельно на каждом результате.
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

/**
 * Набор предметов секции (IMTAHAN_NOVLERI_TASK.md §16): конфиг задаёт ТОЛЬКО состав предметов
 * секции, больше не число вопросов по каждому — оно свойство конкретной работы, а не типа
 * экзамена, и читается из файла/ручного ввода на каждом результате (см. computeScoreSummary).
 */
interface SectionConfig {
    sectionId: number;
    nameAz: string;
    subjects: Map<string, { nameAz: string; sortOrder: number }>;
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
 * `subjects.name_az`, набор предметов берётся из `exam_type_section_subjects` секции, в
 * которую попадает класс строки. `total_score`/`score_percent`/`level`/`participation_score`
 * считаются здесь же, единым путём для ручного создания/правки результата (`create`/`update`)
 * и для массового импорта (`processStudentResultsFromExcel`) — `computeScoreSummary` ниже.
 * Баллы по предметам хранятся в `student_result_subject_scores`, а не в пяти колонках
 * `student_results` (те остаются NULL у всех новых строк — легаси, снос в 026).
 *
 * **§16 (IMTAHAN_NOVLERI_TASK.md, 11.09.2026):** знаменатель процента больше НЕ берётся из
 * конфига типа (`exam_type_section_subjects.max_questions` — колонка снята миграцией
 * 025d_question_counts_from_file.sql). Конфиг секции теперь задаёт только СОСТАВ предметов;
 * число вопросов по каждому предмету — свойство конкретной работы, читается из
 * `question_count` входных данных (файл или ручной ввод) на каждом результате отдельно.
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

        // A new grade or exam can move the result into another section/type, so section, percent
        // and pillə are recomputed even when the client sent no disciplines — from the stored ones.
        const placementChanged = (data.grade !== undefined && data.grade !== current.grade)
            || (data.examId !== undefined && data.examId !== current.exam_id);
        let disciplines = data.disciplines;
        if (disciplines === undefined && placementChanged) {
            const stored = await pg
                .selectFrom("student_result_subject_scores")
                .select(["subject_code", "score", "question_count"])
                .where("result_id", "=", id)
                .execute();
            disciplines = stored.map((s) => ({ subjectCode: s.subject_code, score: s.score, questionCount: s.question_count }));
        }

        if (disciplines !== undefined) {
            const examTypeId = await this.resolveExamTypeId(examId);
            const summary = await this.computeScoreSummary(examTypeId, grade, disciplines);
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
     * Импорт результатов экзамена из Excel (IMTAHAN_NOVLERI_TASK.md §7, аудит 05.10.2026 —
     * IMTAHAN_NOVLERI_AUDIT_2026-10-05_TASK.md, группа 2). Формат: строка 1 — заголовки
     * (`Şagird kodu | Sinif | Soyadı, adı, ata adı | <Fənn>... | <Fənn> (sual sayı)...`, ровно то,
     * что генерирует resultTemplate.service.ts), данные — со строки 2.
     *
     * Правила:
     *  - **один файл — одна секция** (решение Р2): строки классов разных секций типа — ошибка на
     *    весь файл, с перечислением секций и классов;
     *  - колонки файла должны совпадать с составом секции: недостающий предмет больше не
     *    уменьшает знаменатель молча (раньше это завышало процент и pillə), лишний — ошибка;
     *  - построчные проблемы (код, класс, баллы, повтор кода) — в `studentsWithIncorrectResults`
     *    с номером строки Excel, остальные строки импортируются;
     *  - расхождение числа вопросов предмета с самым частым значением по файлу — только
     *    предупреждение (§16: число вопросов — свойство работы, бывает разным законно);
     *  - запись — одной транзакцией и пакетно: либо файл загружен целиком, либо ничего.
     */
    async processStudentResultsFromExcel(filePath: string, examId: number): Promise<StudentResultImportSummary> {
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
            // Месяц/год — по календарному дню в Баку: большинство экзаменов хранится на 20:00Z
            // предыдущего дня (полночь по Баку), и getUTCMonth() отнёс бы экзамен 1-го числа к
            // прошлому месяцу. month/year результата решают месячные награды и учебный год.
            const [year, month] = examDate.toLocaleDateString("en-CA", { timeZone: "Asia/Baku" }).split("-").map(Number);
            // IMTAHAN_NOVLERI_TASK.md §15: то же определение учебного года, что использует
            // markDevelopingStudents() (stats.service.pg.ts) — от month/year результата.
            const academicYearStart = month >= 9 ? year : year - 1;

            const subjects = await subjectServicePg.findAll();
            const headerRow: any[] = Array.isArray(rows[0]) ? rows[0] : [];
            // SAGIRD_FULLNAME_TASK.md §5: заголовок col 2 решает формат имени — одна колонка ФИО
            // (шаблон resultTemplate.service.ts) или три legacy-колонки. Предметы начинаются сразу
            // после имени — col 3 в первом случае, col 5 во втором.
            const nameHeader = normalizeHeader(headerRow[2]);
            const isSingleNameColumn = SINGLE_FULLNAME_HEADERS.has(nameHeader);
            const subjectsStartIdx = isSingleNameColumn ? 3 : 5;

            const subjectColumns = this.parseHeaderColumns(headerRow, subjects, subjectsStartIdx);
            const scoreColByCode = new Map(subjectColumns.filter((c) => !c.isCount).map((c) => [c.subjectCode, c]));
            const countColByCode = new Map(subjectColumns.filter((c) => c.isCount).map((c) => [c.subjectCode, c]));
            if (scoreColByCode.size === 0) {
                throw this.importError("Fayl başlıqlarında fənn sütunları tapılmadı");
            }

            const issues: ImportRowIssue[] = [];
            const invalidStudentCodes: number[] = [];
            const report: ImportIssue[] = [];
            const rowFullname = (row: any[]) => (isSingleNameColumn
                ? String(row[2] ?? "").trim()
                : [row[2], row[3], row[4]].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ")) || null;
            const addReport = (
                row: any[], rowNumber: number, colIdx: number | null, code: number | null,
                kind: string, message: string, severity: "error" | "warning" = "error"
            ) => {
                const cell = colIdx === null ? null : row[colIdx];
                report.push({
                    row: rowNumber,
                    column: colIdx === null ? null : this.colLabel(colIdx),
                    columnName: colIdx === null ? null : String(headerRow[colIdx] ?? "").trim() || null,
                    code, fullname: rowFullname(row),
                    value: cell == null || String(cell).trim() === "" ? null : String(cell),
                    kind, message, severity,
                });
            };

            // A code that appears more than once is ambiguous (which row is right is unknown), so
            // every occurrence is rejected rather than letting the last row silently win.
            const codeOccurrences = new Map<number, number>();
            for (const row of rows.slice(1)) {
                if (!Array.isArray(row)) continue;
                const code = Number(row[0]);
                if (code) codeOccurrences.set(code, (codeOccurrences.get(code) ?? 0) + 1);
            }
            const reportedDuplicateCodes = new Set<number>();

            // Проход 1: код, класс, секция. Строки, прошедшие его, — кандидаты.
            const sectionConfigByGrade = new Map<number, SectionConfig | null>();
            const candidates: Array<{ rowNumber: number; row: any[]; code: number; grade: number; config: SectionConfig }> = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const rowNumber = i + 1; // номер строки в Excel (заголовок — строка 1)
                if (!Array.isArray(row) || row.every((c) => c == null || String(c).trim() === "")) continue;

                const rawCode = row[0];
                const code = Number(rawCode);
                if (rawCode == null || String(rawCode).trim() === "" || isNaN(code)) {
                    issues.push({ row: rowNumber, code: null, reason: `Şagird kodu düzgün deyil ("${rawCode ?? ""}")` });
                    addReport(row, rowNumber, 0, null, "Şagird kodu",
                        rawCode == null || String(rawCode).trim() === "" ? "Şagird kodu boşdur" : "Şagird kodu ədəd deyil");
                    continue;
                }
                if (!Number.isInteger(code) || code < CODE_RANGES.STUDENT_MIN || code > CODE_RANGES.STUDENT_MAX) {
                    invalidStudentCodes.push(code);
                    addReport(row, rowNumber, 0, code, "Şagird kodu", "Şagird kodu 10 rəqəmli tam ədəd olmalıdır");
                    continue;
                }
                const occurrences = codeOccurrences.get(code) ?? 1;
                if (occurrences > 1) {
                    // Every occurrence goes to the report, so all of them can be found in the file.
                    addReport(row, rowNumber, 0, code, "Təkrarlanan kod",
                        `Bu kod faylda ${occurrences} dəfə var — heç bir sətri yüklənmədi, birini saxlayın`);
                    if (!reportedDuplicateCodes.has(code)) {
                        reportedDuplicateCodes.add(code);
                        issues.push({ row: rowNumber, code, reason: `Şagird kodu faylda ${occurrences} dəfə təkrarlanır` });
                    }
                    continue;
                }

                const grade = Number(row[1]);
                if (!grade || !Number.isInteger(grade)) {
                    issues.push({ row: rowNumber, code, reason: `Sinif düzgün deyil ("${row[1] ?? ""}")` });
                    addReport(row, rowNumber, 1, code, "Sinif", "Sinif tam ədəd olmalıdır");
                    continue;
                }

                let config = sectionConfigByGrade.get(grade);
                if (config === undefined) {
                    config = await this.resolveSectionConfig(exam.exam_type_id, grade);
                    sectionConfigByGrade.set(grade, config);
                }
                if (config === null) {
                    issues.push({ row: rowNumber, code, reason: `${grade}-ci sinif üçün bu imtahan növündə bölmə tapılmadı` });
                    addReport(row, rowNumber, 1, code, "Sinif", `${grade}-ci sinif bu imtahan növünün heç bir bölməsinə aid deyil`);
                    continue;
                }

                candidates.push({ rowNumber, row, code, grade, config });
            }

            // Р2: один файл — одна секция.
            const sectionsInFile = new Map<number, { config: SectionConfig; grades: Set<number>; rows: number }>();
            for (const c of candidates) {
                const entry = sectionsInFile.get(c.config.sectionId) ?? { config: c.config, grades: new Set<number>(), rows: 0 };
                entry.grades.add(c.grade);
                entry.rows++;
                sectionsInFile.set(c.config.sectionId, entry);
            }
            if (sectionsInFile.size > 1) {
                const parts = [...sectionsInFile.values()].map((s) =>
                    `${s.config.nameAz} — siniflər: ${[...s.grades].sort((a, b) => a - b).join(", ")} (${s.rows} sətir)`
                );
                throw this.importError(
                    `Faylda müxtəlif bölmələrin şagirdləri var: ${parts.join("; ")}. Hər bölmə üçün ayrıca fayl yükləyin.`
                );
            }

            const section = sectionsInFile.size === 1 ? [...sectionsInFile.values()][0].config : null;
            if (section) {
                // Колонки файла = состав секции, в обе стороны.
                for (const col of scoreColByCode.values()) {
                    if (!section.subjects.has(col.subjectCode)) {
                        throw this.importError(`"${col.nameAz}" fənni "${section.nameAz}" bölməsinin tərkibinə daxil deyil`);
                    }
                }
                for (const col of countColByCode.values()) {
                    if (!scoreColByCode.has(col.subjectCode)) {
                        throw this.importError(`"${col.nameAz}" fənni üçün bal sütunu yoxdur`);
                    }
                }
                const missing = [...section.subjects.entries()].filter(([code]) => !scoreColByCode.has(code)).map(([, s]) => `"${s.nameAz}"`);
                if (missing.length > 0) {
                    throw this.importError(`"${section.nameAz}" bölməsinin fənləri faylda yoxdur: ${missing.join(", ")}`);
                }
                // IMTAHAN_NOVLERI_TASK.md §16: sual sayı sütunu hər fənn üçün mütləqdir.
                for (const [code, s] of section.subjects) {
                    if (!countColByCode.has(code)) {
                        throw this.importError(`"${s.nameAz}" fənni üçün sual sayı sütunu yoxdur`);
                    }
                }
            }

            // Проход 2: баллы и число вопросов.
            const orderedSubjects = section
                ? [...section.subjects.entries()].sort((a, b) => a[1].sortOrder - b[1].sortOrder)
                : [];
            const parsedRows: Array<{
                rowNumber: number; grade: number; studentCode: number; fullname: string;
                subjectScores: Array<{ subjectCode: string; score: number; questionCount: number }>;
                totalScore: number; sectionId: number; maxQuestions: number;
            }> = [];

            for (const c of candidates) {
                let error: { message: string; colIdx: number; kind: string } | null = null;
                let totalScore = 0;
                let totalQuestionCount = 0;
                const subjectScores: Array<{ subjectCode: string; score: number; questionCount: number }> = [];

                for (const [subjectCode, cfg] of orderedSubjects) {
                    const scoreIdx = scoreColByCode.get(subjectCode)!.colIdx;
                    const countIdx = countColByCode.get(subjectCode)!.colIdx;
                    const rawScore = c.row[scoreIdx];
                    const score = rawScore == null || String(rawScore).trim() === "" ? 0 : Number(rawScore);
                    if (isNaN(score)) { error = { message: `${cfg.nameAz}: bal ədəd deyil ("${rawScore}")`, colIdx: scoreIdx, kind: "Bal" }; break; }
                    if (score < 0) { error = { message: `${cfg.nameAz}: bal mənfi ola bilməz (${score})`, colIdx: scoreIdx, kind: "Bal" }; break; }

                    // §16: sual sayı bu sətirdən oxunur — boş/ədəd olmayan/sıfır/mənfi/kəsr — sətir xətası.
                    const rawCount = c.row[countIdx];
                    const questionCount = rawCount == null || String(rawCount).trim() === "" ? NaN : Number(rawCount);
                    if (isNaN(questionCount) || questionCount <= 0) { error = { message: `${cfg.nameAz}: sual sayı göstərilməyib`, colIdx: countIdx, kind: "Sual sayı" }; break; }
                    if (!Number.isInteger(questionCount)) { error = { message: `${cfg.nameAz}: sual sayı tam ədəd olmalıdır (${questionCount})`, colIdx: countIdx, kind: "Sual sayı" }; break; }
                    if (score > questionCount) { error = { message: `${cfg.nameAz}: bal (${score}) sual sayından (${questionCount}) çoxdur`, colIdx: scoreIdx, kind: "Bal" }; break; }

                    totalScore += score;
                    totalQuestionCount += questionCount;
                    subjectScores.push({ subjectCode, score, questionCount });
                }

                if (error) {
                    issues.push({ row: c.rowNumber, code: c.code, reason: error.message });
                    addReport(c.row, c.rowNumber, error.colIdx, c.code, error.kind, error.message);
                    continue;
                }
                if (totalScore <= 0) {
                    issues.push({ row: c.rowNumber, code: c.code, reason: "Sıfır xal: şagird heç bir sual cavablandırmayıb" });
                    addReport(c.row, c.rowNumber, null, c.code, "Bal", "Bütün fənlər üzrə bal 0-dır — nəticə yüklənmədi");
                    continue;
                }

                const fullname = isSingleNameColumn
                    ? String(c.row[2] ?? "").trim()
                    : [c.row[2], c.row[3], c.row[4]].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");

                parsedRows.push({
                    rowNumber: c.rowNumber, grade: c.grade, studentCode: c.code, fullname, subjectScores,
                    totalScore, sectionId: c.config.sectionId, maxQuestions: totalQuestionCount,
                });
            }

            const questionCountWarnings = this.questionCountWarnings(parsedRows, section);
            const candidateByRow = new Map(candidates.map((c) => [c.rowNumber, c]));
            for (const w of questionCountWarnings) {
                const c = candidateByRow.get(w.row)!;
                const subjectCode = [...(section?.subjects.entries() ?? [])].find(([, s]) => s.nameAz === w.subject)?.[0];
                const colIdx = subjectCode ? countColByCode.get(subjectCode)!.colIdx : null;
                addReport(c.row, w.row, colIdx, w.code, "Sual sayı",
                    `${w.subject}: sual sayı ${w.count}, faylda adətən ${w.usual} — yükləndi, yoxlayın`, "warning");
            }

            // Запись — одной транзакцией.
            const { processedCount, studentsWithoutTeacher } = await pg.transaction().execute(async (trx) => {
                const { students, studentsWithoutTeacher } = await this.processStudentResults(
                    trx, parsedRows.map((r) => ({ code: r.studentCode, fullname: r.fullname, grade: r.grade }))
                );
                const studentByCode = new Map(students.map((s) => [s.code, s]));
                const toWrite = parsedRows.filter((r) => studentByCode.has(r.studentCode));

                const priorRanks = await maxPriorBandRanks(
                    trx, toWrite.map((r) => studentByCode.get(r.studentCode)!.id), exam.exam_type_id, academicYearStart, examDate
                );

                const resultRows = toWrite.map((r) => {
                    const studentId = studentByCode.get(r.studentCode)!.id;
                    const scorePercent = r.maxQuestions > 0 ? (r.totalScore / r.maxQuestions) * 100 : 0;
                    const band = levelScaleServicePg.resolveBandCached(examType.levelScaleId, scorePercent);
                    // §15: развитие — рост ранга бэнда относительно более ранних результатов этого же
                    // ученика по этому же типу в этом учебном году (как markDevelopingStudents).
                    const priorMaxRank = priorRanks.get(studentId) ?? null;
                    return {
                        values: {
                            student_id: studentId, exam_id: examId, grade: r.grade,
                            exam_type_id: exam.exam_type_id, section_id: r.sectionId, level_scale_id: examType.levelScaleId,
                            max_questions: r.maxQuestions, score_percent: Number(scorePercent.toFixed(3)),
                            total_score: r.totalScore, level: band.code, participation_score: band.participationScore,
                            development_score: priorMaxRank !== null && band.rank > priorMaxRank ? 10 : 0,
                            score: 1, month, year,
                        },
                        subjectScores: r.subjectScores,
                    };
                });

                const CHUNK = 500;
                for (let i = 0; i < resultRows.length; i += CHUNK) {
                    const chunk = resultRows.slice(i, i + CHUNK);
                    const upserted = await trx
                        .insertInto("student_results")
                        .values(chunk.map((r) => r.values))
                        .onConflict((oc) =>
                            oc.columns(["student_id", "exam_id"]).doUpdateSet((eb) => ({
                                grade: eb.ref("excluded.grade"),
                                exam_type_id: eb.ref("excluded.exam_type_id"),
                                section_id: eb.ref("excluded.section_id"),
                                level_scale_id: eb.ref("excluded.level_scale_id"),
                                max_questions: eb.ref("excluded.max_questions"),
                                score_percent: eb.ref("excluded.score_percent"),
                                total_score: eb.ref("excluded.total_score"),
                                level: eb.ref("excluded.level"),
                                participation_score: eb.ref("excluded.participation_score"),
                                development_score: eb.ref("excluded.development_score"),
                            }))
                        )
                        .returning(["id", "student_id"])
                        .execute();

                    const resultIdByStudent = new Map(upserted.map((u) => [u.student_id, u.id]));
                    const resultIds = upserted.map((u) => u.id);
                    await trx.deleteFrom("student_result_subject_scores").where("result_id", "in", resultIds).execute();
                    const subjectValues = chunk.flatMap((r) =>
                        r.subjectScores.map((s) => ({
                            result_id: resultIdByStudent.get(r.values.student_id)!,
                            subject_code: s.subjectCode, score: s.score, question_count: s.questionCount,
                        }))
                    );
                    if (subjectValues.length > 0) {
                        await trx.insertInto("student_result_subject_scores").values(subjectValues).execute();
                    }
                }

                return { processedCount: resultRows.length, studentsWithoutTeacher };
            });

            await deleteFile(filePath).catch(() => {});

            const candidateByCode = new Map(candidates.map((c) => [c.code, c]));
            for (const code of studentsWithoutTeacher) {
                const c = candidateByCode.get(code);
                if (!c) continue;
                addReport(c.row, c.rowNumber, 0, code, "Layihə müəllimi",
                    `Kodun müəllim hissəsi (${Math.floor(code / CODE_DIVISORS.STUDENT_TO_TEACHER)}) sistemdə yoxdur — şagird yaradılmadı, nəticə yüklənmədi`);
            }
            report.sort((a, b) => a.row - b.row || (a.column ?? "").localeCompare(b.column ?? ""));

            issues.sort((a, b) => a.row - b.row);
            return {
                processedCount,
                sectionName: section?.nameAz ?? null,
                studentsWithoutTeacher,
                incorrectStudentCodes: [...new Set(invalidStudentCodes)],
                studentsWithIncorrectResults: issues,
                questionCountWarnings,
                issues: report,
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    /**
     * Строки, где число вопросов предмета отличается от самого частого значения по файлу —
     * типичная опечатка (51 вместо 15). Только предупреждение: §16 допускает разные длины работы.
     * Мода считается, только если она встречается хотя бы дважды.
     */
    private questionCountWarnings(
        parsedRows: Array<{ rowNumber: number; studentCode: number; subjectScores: Array<{ subjectCode: string; questionCount: number }> }>,
        section: SectionConfig | null
    ): QuestionCountWarning[] {
        if (!section) return [];
        const warnings: QuestionCountWarning[] = [];
        for (const [subjectCode, cfg] of section.subjects) {
            const freq = new Map<number, number>();
            for (const r of parsedRows) {
                const qc = r.subjectScores.find((s) => s.subjectCode === subjectCode)?.questionCount;
                if (qc !== undefined) freq.set(qc, (freq.get(qc) ?? 0) + 1);
            }
            if (freq.size < 2) continue;
            const [usual, usualFreq] = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
            if (usualFreq < 2) continue;
            for (const r of parsedRows) {
                const qc = r.subjectScores.find((s) => s.subjectCode === subjectCode)?.questionCount;
                if (qc !== undefined && qc !== usual) {
                    warnings.push({ row: r.rowNumber, code: r.studentCode, subject: cfg.nameAz, count: qc, usual });
                }
            }
        }
        return warnings.sort((a, b) => a.row - b.row);
    }

    /**
     * Создаёт недостающих учеников (по коду), назначая учителя арифметикой кода — как и раньше.
     * Ученики, для которых учитель не резолвится, НЕ создаются (studentsWithoutTeacher).
     * Пишет в переданную транзакцию импорта. students.max_level снесён миграцией 026
     * (IMTAHAN_NOVLERI_TASK.md §20.2/§15).
     */
    private async processStudentResults(
        trx: Transaction<DB>,
        studentDataToInsert: Array<{ code: number; fullname: string; grade: number }>
    ): Promise<{ students: Array<{ id: number; code: number }>; studentsWithoutTeacher: number[] }> {
        const studentCodes = studentDataToInsert.map((s) => s.code);
        const existingStudents = studentCodes.length > 0
            ? await trx.selectFrom("students").select(["id", "code"]).where("code", "in", studentCodes).execute()
            : [];
        const existingCodes = new Set(existingStudents.map((s) => s.code));
        const newStudents = studentDataToInsert.filter((s) => !existingCodes.has(s.code));

        // Учителя — одним запросом по всем кодам учителей (код ученика / 1000), а не по запросу на ученика.
        const teacherCodes = [...new Set(newStudents.map((s) => Math.floor(s.code / CODE_DIVISORS.STUDENT_TO_TEACHER)))];
        const teachers = teacherCodes.length > 0
            ? await trx.selectFrom("teachers").select(["id", "code", "school_id", "district_id"]).where("code", "in", teacherCodes).execute()
            : [];
        const teacherByCode = new Map(teachers.map((t) => [t.code, t]));

        const studentsWithTeacher: Array<{ code: number; fullname: string; grade: number; teacherId: number; schoolId: number | null; districtId: number | null }> = [];
        const studentsWithoutTeacher: number[] = [];

        for (const s of newStudents) {
            const teacher = teacherByCode.get(Math.floor(s.code / CODE_DIVISORS.STUDENT_TO_TEACHER));
            if (!teacher) {
                studentsWithoutTeacher.push(s.code);
                continue;
            }
            studentsWithTeacher.push({
                code: s.code, fullname: s.fullname, grade: s.grade,
                teacherId: teacher.id, schoolId: teacher.school_id, districtId: teacher.district_id,
            });
        }

        let newStudentsRows: Array<{ id: number; code: number }> = [];
        const CHUNK = 1000;
        for (let i = 0; i < studentsWithTeacher.length; i += CHUNK) {
            const inserted = await trx
                .insertInto("students")
                .values(
                    studentsWithTeacher.slice(i, i + CHUNK).map((s) => ({
                        code: s.code, fullname: s.fullname,
                        grade: s.grade ?? null, teacher_id: s.teacherId, school_id: s.schoolId ?? null, district_id: s.districtId ?? null,
                    }))
                )
                .returning(["id", "code"])
                .execute();
            newStudentsRows = newStudentsRows.concat(inserted);
        }

        return { students: [...existingStudents, ...newStudentsRows], studentsWithoutTeacher };
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
            .select(["id", "name_az"])
            .where("exam_type_id", "=", examTypeId)
            .where("grade_from", "<=", grade)
            .where("grade_to", ">=", grade)
            .executeTakeFirst();
        if (!section) return null;

        const subjectRows = await pg
            .selectFrom("exam_type_section_subjects as ss")
            .innerJoin("subjects as s", "s.code", "ss.subject_code")
            .select(["ss.subject_code", "s.name_az", "ss.sort_order"])
            .where("ss.section_id", "=", section.id)
            .execute();

        if (subjectRows.length === 0) {
            throw this.importError("Bu sinif qrupu üçün fənlər təyin edilməyib");
        }

        const subjects = new Map(
            subjectRows.map((r) => [r.subject_code, { nameAz: r.name_az, sortOrder: r.sort_order }])
        );

        return { sectionId: section.id, nameAz: section.name_az, subjects };
    }

    /**
     * Общий расчёт для ручного create/update одного результата: валидирует предметы против
     * конфига секции (только состав, число вопросов конфиг больше не задаёт — IMTAHAN_NOVLERI_TASK.md
     * §16), считает total_score/score_percent/level/participation_score. Тот же принцип, что
     * использует построчный разбор Excel-импорта, но для одного результата и с исключением
     * вместо построчного пропуска (единичная правка — либо валидна целиком, либо нет).
     *
     * Знаменатель процента — Σ questionCount из ВХОДНЫХ данных (файла или ручного ввода), а не
     * из конфига секции: число вопросов — свойство конкретной работы. Отсутствие или ноль
     * questionCount у любого предмета — ошибка (§16: "молчаливый ноль в знаменателе недопустим").
     */
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
        subjectRows: Array<{ subjectCode: string; score: number; questionCount: number }>;
    }> {
        const config = await this.resolveSectionConfig(examTypeId, grade);
        if (!config) {
            throw this.importError(`${grade}-ci sinif üçün bu imtahan növündə bölmə tapılmadı`);
        }
        if (disciplines.length === 0) {
            throw this.importError("Fənlər üzrə heç bir nəticə göstərilməyib");
        }

        let totalScore = 0;
        let totalQuestionCount = 0;
        const subjectRows: Array<{ subjectCode: string; score: number; questionCount: number }> = [];
        const seenSubjects = new Set<string>();
        for (const d of disciplines) {
            const cfg = config.subjects.get(d.subjectCode);
            if (!cfg) {
                throw this.importError(`"${d.subjectCode}" fənni bu bölmənin tərkibinə daxil deyil`);
            }
            if (seenSubjects.has(d.subjectCode)) {
                throw this.importError(`${cfg.nameAz}: fənn bir neçə dəfə göstərilib`);
            }
            seenSubjects.add(d.subjectCode);

            // The body is client JSON: coerce explicitly, otherwise a string score would turn
            // `totalScore += score` into string concatenation.
            const score = Number(d.score);
            if (d.score == null || String(d.score).trim() === "" || !Number.isFinite(score)) {
                throw this.importError(`${cfg.nameAz}: bal ədəd deyil`);
            }
            if (score < 0) {
                throw this.importError(`${cfg.nameAz}: bal mənfi ola bilməz (${score})`);
            }
            const questionCount = d.questionCount == null ? NaN : Number(d.questionCount);
            if (!Number.isFinite(questionCount) || questionCount <= 0) {
                throw this.importError(`${cfg.nameAz}: sual sayı göstərilməyib`);
            }
            if (!Number.isInteger(questionCount)) {
                throw this.importError(`${cfg.nameAz}: sual sayı tam ədəd olmalıdır (${questionCount})`);
            }
            if (score > questionCount) {
                throw this.importError(`${cfg.nameAz}: bal (${score}) sual sayından (${questionCount}) çoxdur`);
            }
            totalScore += score;
            totalQuestionCount += questionCount;
            subjectRows.push({ subjectCode: d.subjectCode, score, questionCount });
        }

        const examType = await examTypeServicePg.findById(examTypeId);
        if (!examType) throw this.importError("İmtahan növü tapılmadı");

        const scorePercent = totalQuestionCount > 0 ? (totalScore / totalQuestionCount) * 100 : 0;
        const band = await levelScaleServicePg.resolveBand(examType.levelScaleId, scorePercent);

        return {
            sectionId: config.sectionId,
            levelScaleId: examType.levelScaleId,
            maxQuestions: totalQuestionCount,
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
        const byName = new Map(subjects.map((s) => [normalizeHeader(s.nameAz), s]));
        const countSuffix = normalizeHeader(" (sual sayı)");
        const columns: Array<{ colIdx: number; subjectCode: string; nameAz: string; isCount: boolean }> = [];
        // A repeated subject column would be summed twice and then hit the
        // student_result_subject_scores primary key halfway through the import.
        const seenColumns = new Map<string, number>();
        const addColumn = (col: { colIdx: number; subjectCode: string; nameAz: string; isCount: boolean }, text: string) => {
            const key = `${col.subjectCode}|${col.isCount}`;
            const firstIdx = seenColumns.get(key);
            if (firstIdx !== undefined) {
                throw this.importError(
                    `"${text}" sütunu faylda təkrarlanır (${this.colLabel(firstIdx)} və ${this.colLabel(col.colIdx)})`
                );
            }
            seenColumns.set(key, col.colIdx);
            columns.push(col);
        };

        for (let i = startIdx; i < headerRow.length; i++) {
            const raw = headerRow[i];
            const text = raw == null ? "" : String(raw).trim();
            if (text === "") continue;

            const key = normalizeHeader(text);
            if (key.endsWith(countSuffix)) {
                const subject = byName.get(key.slice(0, -countSuffix.length).trim());
                if (!subject) throw this.importError(`Naməlum sütun (${this.colLabel(i)}): "${text}"`);
                addColumn({ colIdx: i, subjectCode: subject.code, nameAz: subject.nameAz, isCount: true }, text);
                continue;
            }

            const subject = byName.get(key);
            if (!subject) throw this.importError(`Naməlum sütun (${this.colLabel(i)}): "${text}"`);
            addColumn({ colIdx: i, subjectCode: subject.code, nameAz: subject.nameAz, isCount: false }, text);
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

        // IMTAHAN_NOVLERI_TASK.md §16: per-subject maxQuestions больше не существует как
        // отдельное понятие (exam_type_section_subjects.max_questions снят) — questionCount на
        // самой строке баллов теперь И ЕСТЬ число вопросов по этому предмету в этой конкретной
        // работе, добавочный JOIN на конфиг секции не нужен.
        const [students, exams, subjectScoreRows] = await Promise.all([
            pg.selectFrom("students").select(["id", "code", "fullname"]).where("id", "in", studentIds).execute(),
            examIds.length > 0 ? pg.selectFrom("exams").select(["id", "name", "date"]).where("id", "in", examIds).execute() : Promise.resolve([]),
            pg
                .selectFrom("student_result_subject_scores as srs")
                .innerJoin("subjects as s", "s.code", "srs.subject_code")
                .select(["srs.result_id", "srs.subject_code", "s.name_az", "srs.score", "srs.question_count"])
                .where("srs.result_id", "in", resultIds)
                .execute(),
        ]);

        const studentById = new Map(students.map((s) => [s.id, s]));
        const examById = new Map(exams.map((e) => [e.id, e]));

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
