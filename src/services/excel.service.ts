import xlsx from "xlsx";
import fs from "fs";

const MAX_EXCEL_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export const readExcel = (filePath: string): any[] => {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_EXCEL_SIZE_BYTES) {
            throw new Error(`Fayl çox böyükdür: maksimum 50 MB icazə verilir (fərdi fayl: ${Math.round(stat.size / 1024 / 1024)} MB)`);
        }

        const workbook = xlsx.readFile(filePath, {
            cellFormula: false, // не парсить формулы
            cellHTML: false,    // не генерировать HTML
            cellNF: false,      // не хранить формат чисел
            cellStyles: false,  // не парсить стили
            sheetStubs: false,  // не создавать заглушки для пустых ячеек
        });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows: any[] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        return rows;
    } catch (error) {
        console.error(error);
        throw error instanceof Error ? error : new Error("Fayl oxuna bilmədi");
    }
}