import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, PageSizes, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import {
    CertificateData,
    CertificateField,
    CertificateFieldType,
    CertificateFontFamily,
    CertificateFontWeight,
    CertificateRenderInput,
} from "../types/certificate.types";
import { azDate, azMonthName, azOrdinal } from "../utils/az-format.util";

// Геометрия рендера — CERTIFICATES_TASK.md §6.2. Расхождение с превью в конструкторе
// (там центрирование по CSS-флексбоксу, здесь — по cap-height шрифта) сознательно не
// устраняется: единственный источник истины — эта функция, дёргаемая и превью, и выдачей.

const PORTRAIT_A4 = PageSizes.A4; // [595.28, 841.89] pt
const FONTS_DIR = path.join(__dirname, "../../assets/fonts");

// Страница по ориентации картинки (CERTIFICATES_V2_TASK.md §3) — «Ayın şagirdi» /
// «Respublika üzrə» пришли альбомными (3508×2480), а раньше страница была жёстко портрет.
function pageSizeFor(imageWidth: number, imageHeight: number): [number, number] {
    return imageWidth > imageHeight ? [PORTRAIT_A4[1], PORTRAIT_A4[0]] : [PORTRAIT_A4[0], PORTRAIT_A4[1]];
}

const FONT_FILES: Record<string, string> = {
    "montserrat:regular": "Montserrat-Regular.ttf",
    "montserrat:semibold": "Montserrat-SemiBold.ttf",
    "montserrat:bold": "Montserrat-Bold.ttf",
    "notoSerif:regular": "NotoSerif-Regular.ttf",
    "notoSerif:bolditalic": "NotoSerif-BoldItalic.ttf",
};

// Доступных начертаний всего 5 (§5 плана). Montserrat без курсива — игнорируем italic.
// Noto Serif — только Regular и BoldItalic, любой другой вес/курсив едет на BoldItalic
// как ближайший реальный файл (это и есть боевой кейс: ФИО ученика, notoSerif+bold+italic).
// Следствие для §1 v2-плана: **жирный** run внутри notoSerif-поля уедет туда же, то есть
// выйдет курсивным — сознательно, отдельного прямого Noto Serif Bold мы не возим.
function resolveFontKey(family: CertificateFontFamily, weight: CertificateFontWeight, italic: boolean): string {
    if (family === "montserrat") return `montserrat:${weight}`;
    if (weight === "regular" && !italic) return "notoSerif:regular";
    return "notoSerif:bolditalic";
}

interface LoadedFont {
    pdfFont: PDFFont;
    capHeightRatio: number; // capHeight / unitsPerEm, 0.72 — запасное значение из §6.2
}

// subset:true ЛОМАЕТ азербайджанские глифы (ə/ş/ğ/ı/…) конкретно у Noto Serif —
// pdf-lib's subsetter теряет часть composite-глифов, текст рассыпается на разрозненные
// огрызки букв с гигантскими пробелами (проверено эмпирически debug-скриптом на
// "Ələkbərov Rüstəm Rauf oğlu": subset:true → "ə    auf  u", subset:false → текст цел).
// У Montserrat та же проверка бага не показала — но не полагаемся на это молча:
// subset всегда false для ЛЮБОГО шрифта здесь. Взамен грузим только те начертания,
// что реально встречаются в layout, а не все 5 файлов на каждый PDF.
async function loadFonts(doc: PDFDocument, layout: CertificateField[]): Promise<Record<string, LoadedFont>> {
    doc.registerFontkit(fontkit as any);

    const neededKeys = new Set<string>();
    for (const f of layout) {
        if (f.type === "qr") continue;
        neededKeys.add(resolveFontKey(f.fontFamily, f.fontWeight, f.italic));
        // **жирный** внутри static — грузим bold-вариант того же семейства заранее,
        // даже если базовый вес поля не bold (парсинг рансов происходит позже).
        if (f.type === "static" && typeof f.text === "string" && f.text.includes("**")) {
            neededKeys.add(resolveFontKey(f.fontFamily, "bold", f.italic));
        }
    }

    const result: Record<string, LoadedFont> = {};
    for (const key of neededKeys) {
        const file = FONT_FILES[key];
        const bytes = fs.readFileSync(path.join(FONTS_DIR, file));
        const pdfFont = await doc.embedFont(bytes, { subset: false });
        const fk = (fontkit as any).create(bytes);
        const capHeightRatio = fk.capHeight && fk.unitsPerEm ? fk.capHeight / fk.unitsPerEm : 0.72;
        result[key] = { pdfFont, capHeightRatio };
    }
    return result;
}

// Значение одиночного типа поля — используется и для полей вида {type: 'month', ...},
// и как резолвер плейсхолдеров {month} внутри static-текста (§1 v2-плана): один источник
// истины, {month} и поле-month не могут разойтись, потому что buквально одна функция.
type SimpleFieldType = Exclude<CertificateFieldType, "static" | "qr">;

const PLACEHOLDER_TYPES: SimpleFieldType[] = [
    "month", "grade", "studentFullName", "schoolName", "districtName",
    "teacherFullName", "examDate", "level", "previousLevel", "serial",
];

function resolveTypeValue(type: SimpleFieldType, data: CertificateData, serial: string): string {
    switch (type) {
        case "month": return azMonthName(data.month);
        case "grade": return azOrdinal(data.grade);
        case "studentFullName": return data.studentFullName;
        case "schoolName": return data.schoolName;
        case "districtName": return data.districtName ?? "";
        case "teacherFullName": return data.teacherFullName;
        case "examDate": return azDate(new Date(data.examDate));
        case "level": return data.level;
        case "previousLevel": return data.previousLevel ?? "";
        case "serial": return serial;
    }
}

// Неизвестный плейсхолдер оставляем как есть ({foo} → {foo}) — админ увидит опечатку
// в превью, это честнее молчаливой пустоты.
function substitutePlaceholders(text: string, data: CertificateData, serial: string): string {
    return text.replace(/\{(\w+)\}/g, (match, name) => {
        if ((PLACEHOLDER_TYPES as string[]).includes(name)) {
            return resolveTypeValue(name as SimpleFieldType, data, serial);
        }
        return match;
    });
}

function fieldRawText(field: CertificateField, data: CertificateData, serial: string): string | null {
    switch (field.type) {
        case "static": return substitutePlaceholders(field.text ?? "", data, serial);
        case "qr": return null; // отрисовывается картинкой, не текстом
        default: return resolveTypeValue(field.type, data, serial);
    }
}

function applyTransform(text: string, transform: CertificateField["transform"]): string {
    switch (transform) {
        case "upper": return text.toLocaleUpperCase("az");
        case "lower": return text.toLocaleLowerCase("az");
        case "capitalize":
            return text.replace(
                /\S+/g,
                (word) => word.charAt(0).toLocaleUpperCase("az") + word.slice(1).toLocaleLowerCase("az")
            );
        default: return text;
    }
}

function hexToRgb(hex: string) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
}

async function embedImageAuto(doc: PDFDocument, bytes: Buffer) {
    try {
        return await doc.embedJpg(bytes);
    } catch {
        return await doc.embedPng(bytes);
    }
}

// ---- Инлайновая разметка: **жирный** ----------------------------------------------

interface Run {
    text: string;
    bold: boolean;
}

// Минимальный парсер: только **...**, без экранирования, без курсива/подчёркивания
// (§1 v2-плана — попросят больше, добавим). Одиночная "*" — обычный символ.
function parseRuns(text: string): Run[] {
    const runs: Run[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
        runs.push({ text: m[1], bold: true });
        last = re.lastIndex;
    }
    if (last < text.length) runs.push({ text: text.slice(last), bold: false });
    return runs.length ? runs : [{ text: "", bold: false }];
}

function fontForRun(
    fonts: Record<string, LoadedFont>,
    field: CertificateField,
    bold: boolean
): LoadedFont {
    const key = resolveFontKey(field.fontFamily, bold ? "bold" : field.fontWeight, field.italic);
    const loaded = fonts[key];
    if (!loaded) throw new Error(`certificate-render: не найден шрифт для ключа ${key}`);
    return loaded;
}

// Жирный run красится field.boldColor, если задан, иначе обычным field.color —
// undefined сохраняет прежнее поведение (весь текст одним цветом).
function colorForRun(field: CertificateField, bold: boolean) {
    return hexToRgb(bold && field.boldColor ? field.boldColor : field.color);
}

// ---- Однострочный рендер (текущее поведение, byte-for-byte без **) ----------------

function drawSingleLineField(
    page: PDFPage,
    fonts: Record<string, LoadedFont>,
    field: CertificateField,
    runs: Run[],
    s: number,
    pageHeight: number
): void {
    const boxX = field.x * s;
    const boxW = field.w * s;
    const topPdf = pageHeight - field.y * s;
    const bottomPdf = pageHeight - (field.y + field.h) * s;

    if (field.mask) {
        const pad = field.mask.padding * s;
        page.drawRectangle({
            x: boxX - pad,
            y: bottomPdf - pad,
            width: boxW + 2 * pad,
            height: (topPdf - bottomPdf) + 2 * pad,
            color: hexToRgb(field.mask.color),
        });
    }

    const totalWidth = (size: number) =>
        runs.reduce((sum, r) => sum + fontForRun(fonts, field, r.bold).pdfFont.widthOfTextAtSize(r.text, size), 0);

    let size = field.fontSize * s;
    const minSize = field.minFontSize * s;
    if (field.autoShrink) {
        while (totalWidth(size) > boxW && size > minSize) {
            size -= 0.5;
        }
    }

    const tw = totalWidth(size);
    let x = boxX;
    if (field.align === "center") x = boxX + (boxW - tw) / 2;
    else if (field.align === "right") x = boxX + boxW - tw;

    const cy = (topPdf + bottomPdf) / 2;
    // Вертикаль считаем по капхайту БАЗОВОГО начертания поля (не бегущего run'а) — при
    // одном run без ** это ровно старая формула, побайтово совпадает с версией до v2.
    const baseCapHeight = fontForRun(fonts, field, false).capHeightRatio * size;
    const y = cy - baseCapHeight / 2;

    for (const r of runs) {
        const font = fontForRun(fonts, field, r.bold);
        page.drawText(r.text, { x, y, size, font: font.pdfFont, color: colorForRun(field, r.bold) });
        x += font.pdfFont.widthOfTextAtSize(r.text, size);
    }
}

// ---- Многострочный рендер: перенос по словам, autoShrink по ширине и высоте -------

interface Word {
    text: string;
    bold: boolean;
}

function wordsFromRuns(runs: Run[]): Word[] {
    const words: Word[] = [];
    for (const r of runs) {
        for (const w of r.text.split(/\s+/)) {
            if (w) words.push({ text: w, bold: r.bold });
        }
    }
    return words;
}

function wrapWords(
    words: Word[],
    fonts: Record<string, LoadedFont>,
    field: CertificateField,
    size: number,
    maxWidth: number
): Word[][] {
    const spaceWidth = fontForRun(fonts, field, false).pdfFont.widthOfTextAtSize(" ", size);
    const lines: Word[][] = [];
    let current: Word[] = [];
    let currentWidth = 0;

    for (const w of words) {
        const font = fontForRun(fonts, field, w.bold);
        const wordWidth = font.pdfFont.widthOfTextAtSize(w.text, size);
        const addWidth = current.length ? spaceWidth + wordWidth : wordWidth;
        if (current.length && currentWidth + addWidth > maxWidth) {
            lines.push(current);
            current = [w];
            currentWidth = wordWidth;
        } else {
            current.push(w);
            currentWidth += addWidth;
        }
    }
    if (current.length) lines.push(current);
    return lines;
}

function lineWidth(line: Word[], fonts: Record<string, LoadedFont>, field: CertificateField, size: number): number {
    const spaceWidth = fontForRun(fonts, field, false).pdfFont.widthOfTextAtSize(" ", size);
    return line.reduce((sum, w, i) => {
        const font = fontForRun(fonts, field, w.bold);
        return sum + font.pdfFont.widthOfTextAtSize(w.text, size) + (i > 0 ? spaceWidth : 0);
    }, 0);
}

function drawMultilineField(
    page: PDFPage,
    fonts: Record<string, LoadedFont>,
    field: CertificateField,
    runs: Run[],
    s: number,
    pageHeight: number
): void {
    const boxX = field.x * s;
    const boxW = field.w * s;
    const boxH = field.h * s;
    const topPdf = pageHeight - field.y * s;
    const bottomPdf = pageHeight - (field.y + field.h) * s;

    if (field.mask) {
        const pad = field.mask.padding * s;
        page.drawRectangle({
            x: boxX - pad,
            y: bottomPdf - pad,
            width: boxW + 2 * pad,
            height: (topPdf - bottomPdf) + 2 * pad,
            color: hexToRgb(field.mask.color),
        });
    }

    const words = wordsFromRuns(runs);
    const lineHeightMult = field.lineHeight ?? 1.25;
    const minSize = field.minFontSize * s;
    let size = field.fontSize * s;
    let lines = wrapWords(words, fonts, field, size, boxW);

    const fitsHeight = (sz: number, lineCount: number) => lineCount * lineHeightMult * sz <= boxH;
    const fitsWidth = (sz: number, ls: Word[][]) => ls.every((l) => lineWidth(l, fonts, field, sz) <= boxW);

    if (field.autoShrink) {
        while (size > minSize && (!fitsWidth(size, lines) || !fitsHeight(size, lines.length))) {
            size -= 0.5;
            lines = wrapWords(words, fonts, field, size, boxW);
        }
    }

    const rowHeight = lineHeightMult * size;
    const totalHeight = lines.length * rowHeight;
    const blockCenterY = (topPdf + bottomPdf) / 2;
    const blockTop = blockCenterY + totalHeight / 2;
    const baseCapHeight = fontForRun(fonts, field, false).capHeightRatio * size;
    const spaceWidth = fontForRun(fonts, field, false).pdfFont.widthOfTextAtSize(" ", size);

    lines.forEach((line, i) => {
        const rowCenterY = blockTop - rowHeight * (i + 0.5);
        const y = rowCenterY - baseCapHeight / 2;

        const lw = lineWidth(line, fonts, field, size);
        let x = boxX;
        if (field.align === "center") x = boxX + (boxW - lw) / 2;
        else if (field.align === "right") x = boxX + boxW - lw;

        for (const w of line) {
            const font = fontForRun(fonts, field, w.bold);
            page.drawText(w.text, { x, y, size, font: font.pdfFont, color: colorForRun(field, w.bold) });
            x += font.pdfFont.widthOfTextAtSize(w.text, size) + spaceWidth;
        }
    });
}

async function drawQrField(
    page: PDFPage,
    doc: PDFDocument,
    field: CertificateField,
    s: number,
    pageHeight: number,
    verifyUrl: string
): Promise<void> {
    const pixelSize = Math.max(Math.round(field.w * 4), 128); // выше разрешение картинки для печати
    const png = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: pixelSize });
    const img = await doc.embedPng(png);
    const boxX = field.x * s;
    const topPdf = pageHeight - field.y * s;
    const side = field.w * s; // квадрат — используется только w, см. §6.1
    page.drawImage(img, { x: boxX, y: topPdf - side, width: side, height: side });
}

export async function renderCertificate(input: CertificateRenderInput): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const fonts = await loadFonts(doc, input.layout);

    const PAGE = pageSizeFor(input.imageWidth, input.imageHeight);
    const s = PAGE[0] / input.imageWidth;
    const expectedHeight = input.imageHeight * s;
    if (Math.abs(expectedHeight - PAGE[1]) > 2) {
        console.warn(
            `certificate-render: пропорции шаблона не A4 (ожидалось ${PAGE[1].toFixed(1)}pt по высоте, ` +
            `получено ${expectedHeight.toFixed(1)}pt) — картинка растянется под страницу`
        );
    }

    const page = doc.addPage(PAGE);

    const imageBytes = fs.readFileSync(input.imagePath);
    const bgImage = await embedImageAuto(doc, imageBytes);
    page.drawImage(bgImage, { x: 0, y: 0, width: PAGE[0], height: PAGE[1] });

    for (const field of input.layout) {
        if (field.type === "qr") {
            await drawQrField(page, doc, field, s, PAGE[1], input.verifyUrl);
            continue;
        }

        const raw = fieldRawText(field, input.data, input.serial);
        if (raw === null) continue;
        const text = applyTransform(`${field.prefix}${raw}${field.suffix}`, field.transform);
        if (!text) continue;

        const runs = parseRuns(text);
        if (field.multiline) {
            drawMultilineField(page, fonts, field, runs, s, PAGE[1]);
        } else {
            drawSingleLineField(page, fonts, field, runs, s, PAGE[1]);
        }
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
}
