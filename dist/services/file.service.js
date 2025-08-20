"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const deleteFile = (filePath) => {
    const fileFullPath = path_1.default.join(__dirname, `../../${filePath}`);
    fs_1.default.unlink(fileFullPath, (err) => {
        if (err) {
            console.error(`Fayl silinən zamanı xəta baş verdi: ${err.message}`);
        }
        else {
            console.log(`Fayl ${fileFullPath} uğurla silindi.`);
        }
    });
};
exports.deleteFile = deleteFile;
