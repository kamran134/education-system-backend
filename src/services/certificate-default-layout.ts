import { CertificateField } from "../types/certificate.types";

// Раскладка «из коробки»: применяется автоматически при загрузке нового шаблона,
// чтобы админ сразу видел готовый сертификат и только подвинул то, что не нравится,
// а не расставлял шесть полей с нуля.
//
// Координаты подобраны не на глаз: пустоты во всех пяти присланных шаблонах
// (A/B/C/D/Lisey) промерены пиксельным анализом, взято пересечение — то есть эти
// значения попадают в свободное место на КАЖДОМ из пяти, а не только на одном.
// Ключевые замеры (px, картинка 2480×3508):
//   • пробел под месяц в строке 1:  пересечение [1435..1738]
//   • начало вшитого «siniflər» в строке 2: минимум 381 (Lisey) → класс правее не лезет
//   • горизонтальная черта под ФИО:  верх минимум 2745 (Lisey), низ максимум 2765
//   • подпись «Layihə müəllimi:»:    правый край максимум 1175 (A), верх минимум 2838
//   • подпись «Tarix:»:              одинакова во всех пяти — 1884..2070, y 3100..3155
//   • верхний левый угол под QR:     0 тёмных пикселей во всех пяти
//
// Если заказчик пришлёт шаблоны в другой вёрстке — правится здесь либо мышью в редакторе.

const TEXT_COLOR = "#33333d";
const NAME_COLOR = "#1b2a6b";

function field(
    partial: Partial<CertificateField> & Pick<CertificateField, "id" | "type" | "x" | "y" | "w" | "h">
): CertificateField {
    return {
        align: "center",
        fontFamily: "montserrat",
        fontWeight: "regular",
        italic: false,
        fontSize: 48,
        color: TEXT_COLOR,
        prefix: "",
        suffix: "",
        transform: "none",
        autoShrink: false,
        minFontSize: 24,
        mask: null,
        ...partial,
    };
}

export function defaultCertificateLayout(): CertificateField[] {
    return [
        // «İSİM layihəsi çərçivəsində ___ ayında» — в пробел строки 1.
        // Самый длинный месяц («sentyabr») = 237px при 54px, влезает в 290 с запасом;
        // autoShrink оставлен на случай шаблона с более узкой щелью.
        field({ id: "d_month", type: "month", x: 1440, y: 1968, w: 290, h: 76, fontSize: 54, autoShrink: true, minFontSize: 30 }),

        // «[2-ci] siniflər arasında» — прижат вправо, вплотную к вшитому слову
        field({ id: "d_grade", type: "grade", x: 96, y: 2052, w: 270, h: 80, align: "right", fontSize: 54, autoShrink: true, minFontSize: 30 }),

        // ФИО — над горизонтальной чертой, курсивной антиквой как в примере заказчика
        field({
            id: "d_studentFullName", type: "studentFullName",
            x: 194, y: 2580, w: 2093, h: 155,
            fontFamily: "notoSerif", fontWeight: "bold", italic: true,
            fontSize: 76, color: NAME_COLOR, autoShrink: true, minFontSize: 30,
        }),

        // Школа в скобках — под чертой
        field({
            id: "d_schoolName", type: "schoolName",
            x: 194, y: 2772, w: 2093, h: 60,
            fontSize: 36, prefix: "(", suffix: ")", autoShrink: true, minFontSize: 20,
        }),

        // Учитель — справа от вшитой подписи «Layihə müəllimi:»
        field({
            id: "d_teacherFullName", type: "teacherFullName",
            x: 1200, y: 2840, w: 1150, h: 76,
            align: "left", fontWeight: "semibold", fontSize: 46, autoShrink: true, minFontSize: 24,
        }),

        // Дата — справа от вшитой подписи «Tarix:»
        field({
            id: "d_examDate", type: "examDate",
            x: 2085, y: 3096, w: 300, h: 66,
            align: "left", fontWeight: "semibold", fontSize: 46,
        }),

        // QR + номер — чистый верхний левый угол
        field({ id: "d_qr", type: "qr", x: 150, y: 150, w: 220, h: 220 }),
        field({ id: "d_serial", type: "serial", x: 130, y: 380, w: 260, h: 34, fontSize: 20, color: "#666666" }),
    ];
}
