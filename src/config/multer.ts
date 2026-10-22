import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { ACHIEVEMENT_MAX_BYTES, achievementDir, parseAchievementEntityId, parseAchievementEntityType } from '../services/achievementFile.service.pg';

// Хранилище для аватаров сущности: <uploads/{entityFolder}/avatars/>/<id сущности>.jpg
// Имя файла — id сущности из req.params.id, старый файл затирается (у сущности одно фото)
const makeAvatarStorage = (entityFolder: string) => {
    const uploadPath = `uploads/${entityFolder}/avatars/`;

    return multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }

            cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
            const entityId = req.params.id;
            const ext = '.jpg'; // Всегда сохраняем как .jpg после обработки на фронте
            const filename = `${entityId}${ext}`;

            // Удаляем старый файл если существует
            const filePath = path.join(uploadPath, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            cb(null, filename);
        }
    });
};

// Фильтр для проверки типа файла
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Yalnız JPEG, JPG və PNG formatları qəbul edilir'));
    }
};

// Экспорт multer instance для аватаров студентов
export const avatarUpload = multer({
    storage: makeAvatarStorage('students'),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: fileFilter
});

// Портретное фото учителя — тот же формат, что и у студента
export const teacherAvatarUpload = multer({
    storage: makeAvatarStorage('teachers'),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: fileFilter
});

// Широкий кавер школы/района — исходники обычно тяжелее портретов
export const schoolAvatarUpload = multer({
    storage: makeAvatarStorage('schools'),
    limits: {
        fileSize: 8 * 1024 * 1024, // 8MB
    },
    fileFilter: fileFilter
});

export const districtAvatarUpload = multer({
    storage: makeAvatarStorage('districts'),
    limits: {
        fileSize: 8 * 1024 * 1024, // 8MB
    },
    fileFilter: fileFilter
});

export const regionAvatarUpload = multer({
    storage: makeAvatarStorage('regions'),
    limits: {
        fileSize: 8 * 1024 * 1024, // 8MB
    },
    fileFilter: fileFilter
});

// Multer для массовой загрузки аватаров
const bulkAvatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/temp/';
        
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Сохраняем с оригинальным именем во временную папку
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const bulkFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(null, false); // Просто пропускаем неподходящие файлы
    }
};

export const bulkAvatarUpload = multer({
    storage: bulkAvatarStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB на файл
        files: 500 // Максимум 500 файлов за раз
    },
    fileFilter: bulkFileFilter
});

// Файлы «Uğurlar» профиля учителя/школы (UGURLAR_FILES_TASK.md). Пишутся сразу в каталог сущности
// (uploads/achievements/<teachers|schools>/<id>/), поэтому роут обязан сначала пройти
// authMiddleware + requireAchievementManager — иначе анонимный запрос оставил бы файл на диске.
// Расширение — по заявленному mimetype; контроллер сверяет его с сигнатурой файла и при
// расхождении удаляет файл, так что в БД попадает только то, что реально лежит на диске.
const ACHIEVEMENT_EXT: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
};

const achievementStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const entityType = parseAchievementEntityType(req.params.entityType);
        const entityId = parseAchievementEntityId(req.params.entityId);
        if (!entityType || !entityId) {
            cb(new Error('Invalid achievement file target'), '');
            return;
        }
        const dir = achievementDir(entityType, entityId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${crypto.randomUUID()}${ACHIEVEMENT_EXT[file.mimetype] ?? '.bin'}`);
    }
});

// defParamCharset: busboy decodes the filename as latin1 by default, which breaks ə/ş/ğ;
// multer 2.x passes the option through but @types/multer does not know it yet.
const achievementFileUpload = multer({
    storage: achievementStorage,
    limits: {
        fileSize: ACHIEVEMENT_MAX_BYTES,
        files: 1,
    },
    defParamCharset: 'utf8',
} as multer.Options);

// Ловит MulterError сам: глобальный errorHandler отвечает на LIMIT_FILE_SIZE текстом про 50 MB.
export const uploadAchievementFile = (req: Request, res: Response, next: NextFunction): void => {
    achievementFileUpload.single('file')(req, res, (err?: unknown) => {
        if (!err) {
            next();
            return;
        }
        if (err instanceof multer.MulterError) {
            const tooBig = err.code === 'LIMIT_FILE_SIZE';
            res.status(tooBig ? 413 : 400).json({
                success: false,
                message: tooBig ? 'Fayl çox böyükdür: maksimum 10 MB' : 'Fayl yüklənərkən xəta baş verdi',
            });
            return;
        }
        next(err);
    });
};
