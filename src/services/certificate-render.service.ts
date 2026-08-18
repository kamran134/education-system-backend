import fs from "fs";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, PageSizes, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import {
    CertificateData,
    CertificateField,
    CertificateFontFamily,
    CertificateFontWeight,
    CertificateRenderInput,
} from "../types/certificate.types";
import { azDate, azMonthName, azOrdinal } from "../utils/az-format.util";

// Геометрия рендера — CERTIFICATES_TASK.md §6.2. Расхождение с превью в конструкторе
// (там центрирование по CSS-флексбоксу, здесь — по cap-height шрифта) сознательно не
// устраняется: единственный источник истины — эта функция, дёргаемая и превью, и выдачей.

const PAGE = PageSizes.A4; // [595.28, 841.89] pt
const FONTS_DIR = path.join(__dirname, "../../assets/fonts");

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

function fieldRawText(field: CertificateField, data: CertificateData, serial: string): string | null {
    switch (field.type) {
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
        case "static": return field.text ?? "";
        case "qr": return null; // отрисовывается картинкой, не текстом
        default: return "";
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

function drawTextField(
    page: PDFPage,
    fonts: Record<string, LoadedFont>,
    field: CertificateField,
    text: string,
    s: number
): void {
    const fontKey = resolveFontKey(field.fontFamily, field.fontWeight, field.italic);
    const loaded = fonts[fontKey];
    if (!loaded) throw new Error(`certificate-render: не найден шрифт для ключа ${fontKey}`);
    const { pdfFont, capHeightRatio } = loaded;

    const boxX = field.x * s;
    const boxW = field.w * s;
    const topPdf = PAGE[1] - field.y * s;
    const bottomPdf = PAGE[1] - (field.y + field.h) * s;

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

    let size = field.fontSize * s;
    const minSize = field.minFontSize * s;
    if (field.autoShrink) {
        while (pdfFont.widthOfTextAtSize(text, size) > boxW && size > minSize) {
            size -= 0.5;
        }
    }

    const textWidth = pdfFont.widthOfTextAtSize(text, size);
    let x = boxX;
    if (field.align === "center") x = boxX + (boxW - textWidth) / 2;
    else if (field.align === "right") x = boxX + boxW - textWidth;

    const cy = (topPdf + bottomPdf) / 2;
    const capHeight = capHeightRatio * size;
    const y = cy - capHeight / 2;

    page.drawText(text, { x, y, size, font: pdfFont, color: hexToRgb(field.color) });
}

async function drawQrField(
    page: PDFPage,
    doc: PDFDocument,
    field: CertificateField,
    s: number,
    verifyUrl: string
): Promise<void> {
    const pixelSize = Math.max(Math.round(field.w * 4), 128); // выше разрешение картинки для печати
    const png = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, width: pixelSize });
    const img = await doc.embedPng(png);
    const boxX = field.x * s;
    const topPdf = PAGE[1] - field.y * s;
    const side = field.w * s; // квадрат — используется только w, см. §6.1
    page.drawImage(img, { x: boxX, y: topPdf - side, width: side, height: side });
}

export async function renderCertificate(input: CertificateRenderInput): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const fonts = await loadFonts(doc, input.layout);

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
            await drawQrField(page, doc, field, s, input.verifyUrl);
            continue;
        }

        const raw = fieldRawText(field, input.data, input.serial);
        if (raw === null) continue;
        const text = applyTransform(`${field.prefix}${raw}${field.suffix}`, field.transform);
        if (!text) continue;

        drawTextField(page, fonts, field, text, s);
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
}
