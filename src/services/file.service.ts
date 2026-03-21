import fs from "fs/promises";
import path from "path";

// Единственная разрешённая корневая директория для всех файловых операций
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/**
 * Безопасно удаляет файл внутри директории uploads/.
 * Бросает ошибку если путь выходит за пределы uploads/ (path traversal защита).
 */
export const deleteFile = async (filePath: string): Promise<void> => {
    // Нормализуем: убираем ведущий слэш, чтобы path.resolve не трактовал как абсолютный
    const normalizedPath = filePath.replace(/^[/\\]+/, "");
    const resolvedPath = path.resolve(UPLOADS_ROOT, normalizedPath);

    if (!resolvedPath.startsWith(UPLOADS_ROOT + path.sep) && resolvedPath !== UPLOADS_ROOT) {
        throw new Error(`Недопустимый путь к файлу: "${filePath}"`);
    }

    await fs.unlink(resolvedPath);
};