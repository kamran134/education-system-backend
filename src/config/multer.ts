import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Настройка хранилища для аватаров студентов
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/students/avatars/';
        
        // Создаем папку если её нет
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const studentId = req.params.id;
        const ext = '.jpg'; // Всегда сохраняем как .jpg после обработки на фронте
        const filename = `${studentId}${ext}`;
        
        // Удаляем старый файл если существует
        const filePath = path.join('uploads/students/avatars/', filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        cb(null, filename);
    }
});

// Фильтр для проверки типа файла
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Yalnız JPEG, JPG və PNG formatları qəbul edilir'));
    }
};

// Экспорт multer instance для аватаров
export const avatarUpload = multer({
    storage: avatarStorage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: fileFilter
});
