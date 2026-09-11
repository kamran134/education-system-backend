// IMTAHAN_NOVLERI_TASK.md §18.3: обычный `xlsx` (community) не умеет стили ячеек, только
// `!cols` для ширины. `xlsx-js-style` — форк с тем же API плюс `cell.s`; фронт уже на нём
// (`core/services/excel.service.ts`). Остальной бэкенд, читающий Excel (`excel.service.ts`,
// `booklet.service.pg.ts`), остаётся на community `xlsx` — чтению стили не нужны, менять не просили.
import xlsx from "xlsx-js-style";
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
    generateForSection(examType: ExamTypeRow, section: ExamTypeSectionRow): Buffer {
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
        // плюс небольшой запас (2 символа). Данные (их в шаблоне и нет — только строка
        // заголовков) намеренно без оформления. Лёгкая заливка не добавлена — заказчик прямо
        // назвал её не принципиальной, а жирный + ширина колонок дают читаемый результат и без неё.
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
        xlsx.utils.book_append_sheet(workbook, sheet, "Nəticələr");
        return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    }

    /** `GET /exams/:id/results-template.xlsx?grade=N` (§7) — резолвит секцию по экзамену и классу. */
    async generate(examId: number, grade: number): Promise<{ buffer: Buffer; filename: string }> {
        const exam = await pg
            .selectFrom("exams")
            .select(["id", "exam_type_id"])
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

        const buffer = this.generateForSection(examType, section);
        return { buffer, filename: `netice-sablonu-imtahan-${exam.id}-sinif-${grade}.xlsx` };
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
