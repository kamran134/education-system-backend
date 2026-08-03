import fs from 'fs';
import path from 'path';
import { Model, Document } from 'mongoose';

interface HasAvatar extends Document {
    avatarUrl?: string;
}

/**
 * Сохраняет присланный multer'ом файл как avatarUrl сущности.
 * Файл на диск уже положен multer'ом (makeAvatarStorage) под именем `${id}.jpg` —
 * здесь только обновляем ссылку в БД и подчищаем файл, если сущность не нашлась.
 */
export async function saveEntityAvatar<T extends HasAvatar>(
    model: Model<T>,
    entityId: string,
    file: Express.Multer.File,
    urlPrefix: string
): Promise<string | null> {
    const avatarUrl = `${urlPrefix}/${file.filename}`;

    const entity = await model.findByIdAndUpdate(entityId, { avatarUrl }, { new: true });

    if (!entity) {
        fs.unlinkSync(file.path);
        return null;
    }

    return entity.avatarUrl!;
}

/**
 * Удаляет файл аватарки сущности с диска и очищает avatarUrl.
 * @returns false, если сущность не найдена
 */
export async function removeEntityAvatar<T extends HasAvatar>(
    model: Model<T>,
    entityId: string
): Promise<boolean> {
    const entity = await model.findById(entityId);

    if (!entity) {
        return false;
    }

    if (entity.avatarUrl) {
        const avatarPath = path.join(process.cwd(), entity.avatarUrl);
        if (fs.existsSync(avatarPath)) {
            fs.unlinkSync(avatarPath);
        }

        entity.avatarUrl = undefined;
        await entity.save();
    }

    return true;
}

/**
 * superadmin/admin управляют аватаркой любой сущности; владелец (учитель/школа/район,
 * привязанный к своему teacherId/schoolId/districtId в JWT) — только своей.
 */
export function canManageAvatar(role: string | undefined, ownEntityId: string | undefined, targetId: string): boolean {
    if (role === 'superadmin' || role === 'admin') {
        return true;
    }

    return !!ownEntityId && ownEntityId === targetId;
}
