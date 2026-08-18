import { CertificateField } from "../types/certificate.types";

// Пересчёт координат раскладки при переносе с одного шаблона на другой (переиспользование
// настроенной раскладки, CERTIFICATE_LAYOUT_REUSE_TASK.md). Координаты хранятся в px
// исходной картинки (§6.1 основного ТЗ) — при разных размерах картинок их надо смасштабировать,
// иначе поля уедут. При равных размерах (боевой случай — все пять шаблонов заказчика
// 2480×3508) sx=sy=1 и результат совпадает с источником побайтово.
export function scaleLayout(
    fields: CertificateField[],
    from: { width: number; height: number },
    to: { width: number; height: number }
): CertificateField[] {
    const sx = to.width / from.width;
    const sy = to.height / from.height;

    if (sx === 1 && sy === 1) {
        return fields.map((f) => ({ ...f, mask: f.mask ? { ...f.mask } : null }));
    }

    return fields.map((f) => ({
        ...f,
        x: Math.round(f.x * sx),
        y: Math.round(f.y * sy),
        w: Math.max(1, Math.round(f.w * sx)),
        h: Math.max(1, Math.round(f.h * sy)),
        // Кегль привязан к ширине бокса, не к высоте — иначе при неравных sx/sy текст
        // разъедется с рамкой поля.
        fontSize: Math.max(1, Math.round(f.fontSize * sx)),
        minFontSize: Math.max(1, Math.round(f.minFontSize * sx)),
        mask: f.mask ? { ...f.mask, padding: Math.max(0, Math.round(f.mask.padding * sx)) } : null,
    }));
}
