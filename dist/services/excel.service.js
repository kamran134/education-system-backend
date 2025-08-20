"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readExcel = void 0;
const xlsx_1 = __importDefault(require("xlsx"));
const readExcel = (filePath) => {
    try {
        const workbook = xlsx_1.default.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx_1.default.utils.sheet_to_json(sheet, { header: 1 });
        return rows;
    }
    catch (error) {
        console.error(error);
        throw new Error("Fayl oxuna bilmədi");
    }
};
exports.readExcel = readExcel;
