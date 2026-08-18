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
    /** Только для type === 'static' */
    text?: string;
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
