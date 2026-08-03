import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

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
