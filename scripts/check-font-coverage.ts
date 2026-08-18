// Разовая проверка: все шрифты сертификатов реально содержат азербайджанские глифы.
// Прогоняется руками после добавления/замены шрифта в assets/fonts, не часть CI.
// Падает с ненулевым кодом, если хотя бы один символ не резолвится в глиф.
import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";

const FONTS_DIR = path.join(__dirname, "../assets/fonts");
const AZ_CHARS = "ƏəĞğİıŞşÇçÖöÜü";

const FILES = [
    "Montserrat-Regular.ttf",
    "Montserrat-SemiBold.ttf",
    "Montserrat-Bold.ttf",
    "NotoSerif-Regular.ttf",
    "NotoSerif-BoldItalic.ttf",
];

let failed = false;

for (const file of FILES) {
    const filePath = path.join(FONTS_DIR, file);
    if (!fs.existsSync(filePath)) {
        console.error(`ОТСУТСТВУЕТ: ${file}`);
        failed = true;
        continue;
    }

    const font = fontkit.create(fs.readFileSync(filePath));
    const missing: string[] = [];

    for (const ch of AZ_CHARS) {
        const glyph = font.glyphForCodePoint(ch.codePointAt(0)!);
        if (!glyph || glyph.id === 0) {
            missing.push(ch);
        }
    }

    if (missing.length > 0) {
        console.error(`${file}: нет глифов для [${missing.join(" ")}]`);
        failed = true;
    } else {
        console.log(`${file}: ok (${AZ_CHARS.length} символов)`);
    }
}

if (failed) {
    console.error("\nПроверка покрытия провалена.");
    process.exit(1);
}

console.log("\nВсе шрифты покрывают азербайджанский алфавит.");
