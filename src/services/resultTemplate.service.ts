import xlsx from "xlsx";
import { pg } from "../config/pg";
import { examTypeServicePg } from "./examType.service.pg";

/**
 * Генератор шаблона загрузки результатов (IMTAHAN_NOVLERI_TASK.md §7):
 * `GET /exams/:id/results-template.xlsx?grade=N`. Формат физически не может разойтись с
 * настройкой типа экзамена — колонки собираются из `exam_type_section_subjects` секции, в
 * которую попадает класс N, а не заданы отдельно. Колонки "(sual sayı)" присутствуют только
 * при `has_question_counts = true`. Колонок "итог"/"pillə" в шаблоне нет — их считает бэкенд
 * при импорте (`studentResult.service.pg.ts`).
 */
export class ResultTemplateService {
    async generate(examId: number, grade: number): Promise<{ buffer: Buffer; filename: string }> {
        const exam = await pg
            .selectFrom("exams")
            .select(["id", "code", "exam_type_id"])
            .where("id", "=", examId)
            .executeTakeFirst();
        if (!exam) {
            const err: any = new Error("İmtahan tapılmadı");
            err.status = 404;
            throw err;
        }

        const examType = await examTypeServicePg.findById(exam.exam_type_id);
        if (!examType) {
            const err: any = new Error("İmtahan növü tapılmadı");
            err.status = 404;
            throw err;
        }

        const section = examType.sections.find((s) => grade >= s.gradeFrom && grade <= s.gradeTo);
        if (!section) {
            const err: any = new Error(`${grade}-ci sinif üçün bu imtahan növündə bölmə tapılmadı`);
            err.status = 400;
            throw err;
        }
        if (section.subjects.length === 0) {
            // Штатное состояние свежесозданного типа/секции "5-11 sinif" сразу после
            // 023_exam_types_and_level_scales.sql (§3 ТЗ) — предметы заводит админ в редакторе типов.
            const err: any = new Error("Bu sinif qrupu üçün fənlər təyin edilməyib");
            err.status = 400;
            throw err;
        }

        const header: string[] = ["Şagird kodu", "Sinif", "Soyad", "Ad", "Ata adı"];
        const orderedSubjects = [...section.subjects].sort((a, b) => a.sortOrder - b.sortOrder);
        for (const subject of orderedSubjects) {
            header.push(subject.nameAz);
            if (examType.hasQuestionCounts) {
                header.push(`${subject.nameAz} (sual sayı)`);
            }
        }

        const sheet = xlsx.utils.aoa_to_sheet([header]);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, sheet, "Nəticələr");
        const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

        return { buffer, filename: `netice-sablonu-imtahan-${exam.code}-sinif-${grade}.xlsx` };
    }
}

export const resultTemplateService = new ResultTemplateService();
