// IMTAHAN_NOVLERI_TASK.md §18.3: обычный `xlsx` (community) не умеет стили ячеек, только
// `!cols` для ширины. `xlsx-js-style` — форк с тем же API плюс `cell.s`; фронт уже на нём
// (`core/services/excel.service.ts`). Остальной бэкенд, читающий Excel (`excel.service.ts`,
// `booklet.service.pg.ts`), остаётся на community `xlsx` — чтению стили не нужны, менять не просили.
import xlsx from "xlsx-js-style";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { pg } from "../config/pg";
import { examTypeServicePg, ExamTypeRow, ExamTypeSectionRow } from "./examType.service.pg";

/**
 * Транслит азербайджанских букв в ASCII + слаг без пробелов, для имени файла шаблона
 * (IMTAHAN_NOVLERI_TASK.md §18.1: "секция в имени — транслитом/слагом без пробелов").
 */
function slugify(text: string): string {
    const translitMap: Record<string, string> = {
        ə: "e", Ə: "E", ö: "o", Ö: "O", ü: "u", Ü: "U",
        ş: "s", Ş: "S", ç: "c", Ç: "C", ğ: "g", Ğ: "G",
        ı: "i", İ: "I",
    };
    const translit = text.split("").map((ch) => translitMap[ch] ?? ch).join("");
    const slug = translit
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "bolme";
}

/** Rows covered by the template's data validations — well above any single section file. */
const VALIDATED_ROWS = 10000;

function escapeXml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * xlsx-js-style can write neither frozen panes nor data validations, so both are spliced into the
 * results sheet's XML after the workbook is written (IMTAHAN_NOVLERI_AUDIT_2026-10-05_TASK.md 3.5).
 * Placement follows the CT_Worksheet element order: <pane> goes inside <sheetView>, and
 * <dataValidations> directly after </sheetData> (nothing between them is ever emitted here).
 */
function addFreezeAndValidations(workbook: Buffer, validations: string[]): Buffer {
    const files = unzipSync(new Uint8Array(workbook));
    const path = "xl/worksheets/sheet1.xml";
    let sheetXml = strFromU8(files[path]);

    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
    const withPane = sheetXml.replace(/<sheetView([^>]*?)\/>/, `<sheetView$1>${pane}</sheetView>`);
    if (withPane === sheetXml) throw new Error("resultTemplate: <sheetView/> not found in generated sheet");
    sheetXml = withPane;

    if (validations.length > 0) {
        if (!sheetXml.includes("</sheetData>")) throw new Error("resultTemplate: </sheetData> not found in generated sheet");
        const block = `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`;
        sheetXml = sheetXml.replace("</sheetData>", `</sheetData>${block}`);
    }

    files[path] = strToU8(sheetXml);
    return Buffer.from(zipSync(files));
}

/**
 * Генератор шаблона загрузки результатов (IMTAHAN_NOVLERI_TASK.md §7, §16, §18).
 *
 * `generateForSection()` — единственное место, где строится заголовок шаблона; и
 * `GET /exams/:id/results-template.xlsx?grade=N` (§7, диалог загрузки результатов конкретного
 * экзамена), и `GET /exam-types/:id/results-template.xlsx?sectionId=X` (§18.1, список типов —
 * шаблон без привязки к конкретному экзамену) зовут именно её. Формат физически не может
 * разойтись с настройкой типа экзамена — колонки собираются из набора предметов секции, а не
 * заданы отдельно. Колонки "(sual sayı)" присутствуют ВСЕГДА, для каждого предмета (§16:
 * `exam_types.has_question_counts` снят миграцией 025d — знаменатель процента теперь всегда
 * читается из файла, а не из конфига типа, поэтому счётчик обязателен независимо от типа
 * экзамена). Колонок "итог"/"pillə" в шаблоне нет — их считает бэкенд при импорте
 * (`studentResult.service.pg.ts`).
 *
 * §18.2: порядок колонок — сначала баллы ВСЕХ предметов, потом счётчики ВСЕХ предметов (было
 * чередование "предмет / предмет (sual sayı)"). Парсер (`parseHeaderColumns` в
 * `studentResult.service.pg.ts`) опознаёт колонки по названию/суффиксу " (sual sayı)", а не по
 * позиции — порядку колонок это правило не мешает (проверено по коду, см. журнал §18).
 */
export class ResultTemplateService {
    /**
     * Строит буфер .xlsx с одной строкой заголовков для данной секции. Секция без предметов —
     * ошибка (штатное состояние свежесозданной секции до того, как админ настроит предметы,
     * §3/§7 ТЗ), а не деление на ноль при импорте.
     */
    generateForSection(
        examType: ExamTypeRow,
        section: ExamTypeSectionRow,
        context?: { examName?: string; examDate?: Date }
    ): Buffer {
        if (section.subjects.length === 0) {
            const err: any = new Error("Bu sinif qrupu üçün fənlər təyin edilməyib");
            err.status = 400;
            throw err;
        }

        // SAGIRD_FULLNAME_TASK.md §5: одна колонка ФИО вместо трёх legacy — заголовок должен
        // ТОЧНО совпадать с SINGLE_FULLNAME_HEADERS в studentResult.service.pg.ts (сравнение
        // регистронезависимое, но текст — тот же).
        const header: string[] = ["Şagird kodu", "Sinif", "Soyadı, adı, ata adı"];
        const orderedSubjects = [...section.subjects].sort((a, b) => a.sortOrder - b.sortOrder);
        // §18.2: сначала все баллы, потом все счётчики — два отдельных прохода по одному и
        // тому же отсортированному списку предметов.
        for (const subject of orderedSubjects) {
            header.push(subject.nameAz);
        }
        for (const subject of orderedSubjects) {
            header.push(`${subject.nameAz} (sual sayı)`);
        }

        const sheet = xlsx.utils.aoa_to_sheet([header]);

        // §18.3: заголовки — жирным; ширина каждой колонки — по длине текста её заголовка,
        // плюс небольшой запас (2 символа).
        const headerStyle = { font: { bold: true } };
        const cols: Array<{ wch: number }> = [];
        header.forEach((text, c) => {
            const address = xlsx.utils.encode_cell({ r: 0, c });
            const cell = sheet[address];
            if (cell) cell.s = headerStyle;
            cols.push({ wch: text.length + 2 });
        });
        sheet["!cols"] = cols;

        const workbook = xlsx.utils.book_new();
        // Лист результатов обязан быть первым: excel.service.ts::readExcel читает SheetNames[0].
        xlsx.utils.book_append_sheet(workbook, sheet, "Nəticələr");
        xlsx.utils.book_append_sheet(
            workbook, this.instructionsSheet(examType, section, orderedSubjects.map((s) => s.nameAz), context), "Təlimat"
        );
        const raw = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

        // Проверка данных — подсказка при вводе, не замена серверной проверки (импорт проверяет всё сам).
        const col = (idx: number) => xlsx.utils.encode_col(idx);
        const last = VALIDATED_ROWS + 1;
        const firstScore = 3;
        const lastScore = firstScore + orderedSubjects.length - 1;
        const firstCount = lastScore + 1;
        const lastCount = firstCount + orderedSubjects.length - 1;
        const grades = Array.from({ length: section.gradeTo - section.gradeFrom + 1 }, (_, i) => section.gradeFrom + i);
        const rule = (attrs: string, sqref: string, title: string, error: string, formula: string) =>
            `<dataValidation ${attrs} allowBlank="1" showErrorMessage="1" errorTitle="${escapeXml(title)}" `
            + `error="${escapeXml(error)}" sqref="${sqref}"><formula1>${escapeXml(formula)}</formula1></dataValidation>`;
        return addFreezeAndValidations(raw, [
            rule('type="list"', `B2:B${last}`, "Sinif",
                `Bu şablon "${section.nameAz}" bölməsi üçündür: sinif ${grades.join(", ")} olmalıdır`, `"${grades.join(",")}"`),
            rule('type="decimal" operator="greaterThanOrEqual"', `${col(firstScore)}2:${col(lastScore)}${last}`, "Bal",
                "Bal 0 və ya müsbət ədəd olmalıdır", "0"),
            rule('type="whole" operator="greaterThanOrEqual"', `${col(firstCount)}2:${col(lastCount)}${last}`, "Sual sayı",
                "Sual sayı müsbət tam ədəd olmalıdır", "1"),
        ]);
    }

    /** Второй лист «Təlimat»: к чему относится шаблон и как его заполнять. Парсер его не читает. */
    private instructionsSheet(
        examType: ExamTypeRow,
        section: ExamTypeSectionRow,
        subjectNames: string[],
        context?: { examName?: string; examDate?: Date }
    ): xlsx.WorkSheet {
        const rows: string[][] = [];
        if (context?.examName) {
            const date = context.examDate ? ` (${context.examDate.toLocaleDateString("ru-RU", { timeZone: "Asia/Baku" })})` : "";
            rows.push(["İmtahan", `${context.examName}${date}`]);
        }
        rows.push(
            ["İmtahan növü", examType.nameAz],
            ["Bölmə", `${section.nameAz} (siniflər ${section.gradeFrom}-${section.gradeTo})`],
            ["Fənlər", subjectNames.join(", ")],
            [],
            ["Qaydalar", "1. Bir fayl — bir bölmə: başqa bölmənin sinifləri olan fayl tam rədd edilir."],
            ["", "2. Sütun başlıqlarını dəyişməyin və silməyin — fənlər başlığa görə tanınır."],
            ["", "3. Hər fənn üçün həm bal, həm də \"(sual sayı)\" sütunu doldurulmalıdır; boş bal 0 sayılır."],
            ["", "4. Bal sual sayından çox ola bilməz; şagird kodu 10 rəqəmli olmalıdır."],
            ["", "5. Eyni şagird kodu faylda yalnız bir dəfə ola bilər."],
        );
        const sheet = xlsx.utils.aoa_to_sheet(rows);
        rows.forEach((_, r) => {
            const cell = sheet[xlsx.utils.encode_cell({ r, c: 0 })];
            if (cell) cell.s = { font: { bold: true } };
        });
        sheet["!cols"] = [{ wch: 16 }, { wch: 100 }];
        return sheet;
    }

    /** `GET /exams/:id/results-template.xlsx?grade=N` (§7) — резолвит секцию по экзамену и классу. */
    async generate(examId: number, grade: number): Promise<{ buffer: Buffer; filename: string }> {
        const exam = await pg
            .selectFrom("exams")
            .select(["id", "name", "date", "exam_type_id"])
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

        const buffer = this.generateForSection(examType, section, { examName: exam.name, examDate: new Date(exam.date) });
        return { buffer, filename: `netice-sablonu-${slugify(exam.name)}-${slugify(section.nameAz)}.xlsx` };
    }

    /**
     * `GET /exam-types/:id/results-template.xlsx?sectionId=X` (§18.1) — резолвит секцию по
     * типу экзамена напрямую, без привязки к конкретному экзамену (список типов заранее не
     * знает, по какому экзамену будет загрузка).
     */
    async generateForType(examTypeId: number, sectionId: number): Promise<{ buffer: Buffer; filename: string }> {
        const examType = await examTypeServicePg.findById(examTypeId);
        if (!examType) {
            const err: any = new Error("İmtahan növü tapılmadı");
            err.status = 404;
            throw err;
        }

        const section = examType.sections.find((s) => s.id === sectionId);
        if (!section) {
            const err: any = new Error("Bölmə tapılmadı");
            err.status = 404;
            throw err;
        }

        const buffer = this.generateForSection(examType, section);
        const filename = `netice-sablonu-${slugify(examType.code)}-${slugify(section.nameAz)}.xlsx`;
        return { buffer, filename };
    }
}

export const resultTemplateService = new ResultTemplateService();
