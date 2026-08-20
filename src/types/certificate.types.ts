// Контракт раскладки шаблона сертификата — CERTIFICATES_TASK.md §6.1.
// Один и тот же тип используется конструктором в админке (сохранение/превью) и
// рендерером (certificate-render.service.ts). Координаты — px картинки-шаблона,
// origin — левый верхний угол.

export type CertificateFieldType =
    | "month"
    | "grade"
    | "studentFullName"
    | "schoolName"
    | "districtName"
    | "teacherFullName"
    | "examDate"
    | "level"
    | "previousLevel"
    | "serial"
    | "qr"
    | "static";

export type CertificateFieldAlign = "left" | "center" | "right";
export type CertificateFontFamily = "montserrat" | "notoSerif";
export type CertificateFontWeight = "regular" | "semibold" | "bold";
export type CertificateTextTransform = "none" | "upper" | "lower" | "capitalize";

export interface CertificateFieldMask {
    color: string; // hex, например "#ffffff"
    padding: number; // px картинки
}

export interface CertificateField {
    id: string;
    type: CertificateFieldType;
    x: number;
    y: number;
    w: number;
    h: number;
    align: CertificateFieldAlign;
    fontFamily: CertificateFontFamily;
    fontWeight: CertificateFontWeight;
    italic: boolean;
    fontSize: number;
    color: string;
    prefix: string;
    suffix: string;
    transform: CertificateTextTransform;
    autoShrink: boolean;
    minFontSize: number;
    mask: CertificateFieldMask | null;
    /** Только для type === 'static'. Поддерживает плейсхолдеры {month}/{grade}/{level}/…
     *  (та же линейка типов, что CertificateFieldType) и инлайновый **жирный** —
     *  см. CERTIFICATES_V2_TASK.md §1. */
    text?: string;
    /** Цвет **жирного** участка, если должен отличаться от основного `color` (например,
     *  тёмно-синий как «Karyera və Psixologiya» на самом шаблоне). `undefined` — жирный
     *  красится тем же `color`, что и остальной текст (обратная совместимость). */
    boldColor?: string;
    /** Перенос по словам вместо одной строки. Опционально: у полей, сохранённых до
     *  v2, этого ключа нет в JSON — везде читать как `field.multiline ?? false`. */
    multiline?: boolean;
    /** Множитель кегля для высоты строки при multiline. `field.lineHeight ?? 1.25`. */
    lineHeight?: number;
}

// Значения полей на конкретном сертификате — то, что печатается. Обязательные поля
// не помечены '?': без них выдача не проходит (см. certificate-issue.service.ts).
export interface CertificateData {
    studentFullName: string;
    schoolName: string;
    districtName: string | null;
    grade: number;
    month: number;
    year: number;
    examDate: string; // ISO 'YYYY-MM-DD'
    level: string;
    previousLevel: string | null;
    teacherFullName: string;
}

export interface CertificateRenderInput {
    imagePath: string; // абсолютный путь на диске
    imageWidth: number;
    imageHeight: number;
    layout: CertificateField[];
    data: CertificateData;
    serial: string;
    verifyUrl: string;
}
