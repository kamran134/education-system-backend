import fs from 'fs';
import path from 'path';
import { Model, Document } from 'mongoose';
import { pg } from '../config/pg';

/** Таблицы с колонкой avatar_url. regions добавлен вместе с PHASE3 п.1б (REGIONS_TASKS.md). */
type AvatarTable = 'districts' | 'schools' | 'teachers' | 'students' | 'regions';

/** Postgres-версия saveEntityAvatar/removeEntityAvatar — см. Mongo-версии ниже, поведение то же. */
export async function saveEntityAvatarPg(
    table: AvatarTable,
    entityId: number,
    file: Express.Multer.File,
    urlPrefix: string
): Promise<string | null> {
    const avatarUrl = `${urlPrefix}/${file.filename}`;

    const updated = await pg
        .updateTable(table)
        .set({ avatar_url: avatarUrl })
        .where('id', '=', entityId)
        .returning('avatar_url')
        .executeTakeFirst();

    if (!updated) {
        fs.unlinkSync(file.path);
        return null;
    }

    return updated.avatar_url!;
}

export async function removeEntityAvatarPg(table: AvatarTable, entityId: number): Promise<boolean> {
    const entity = await pg.selectFrom(table).select('avatar_url').where('id', '=', entityId).executeTakeFirst();

    if (!entity) {
        return false;
    }

    if (entity.avatar_url) {
        const avatarPath = path.join(process.cwd(), entity.avatar_url);
        if (fs.existsSync(avatarPath)) {
            fs.unlinkSync(avatarPath);
        }

        await pg.updateTable(table).set({ avatar_url: null }).where('id', '=', entityId).execute();
    }

    return true;
}

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

/** Роли, которые управляют чужими сущностями наравне с админом. moderator раньше отсутствовал
 *  здесь: PUT /:id ему разрешён на уровне роутов, но canManageOwnEntity его не пропускала —
 *  расхождение, не замеченное, пока правка сущности была ещё доступна и владельцу тоже
 *  (PROFILES_V2_TASK.md §2.3). */
const ADMIN_LIKE_ROLES = ['superadmin', 'admin', 'moderator'];

export function isAdminLike(role: string | undefined): boolean {
    return !!role && ADMIN_LIKE_ROLES.includes(role);
}

/**
 * admin-подобные роли управляют любой сущностью; владелец (учитель/школа/район/регион,
 * привязанный к своему teacherId/schoolId/districtId/regionId в JWT) — только своей.
 * С PROFILES_V2_TASK.md остаётся в силе только для аватарки: владелец больше не правит
 * текстовые поля профиля самостоятельно (см. isAdminLike в updateProfile-контроллерах).
 */
export function canManageOwnEntity(role: string | undefined, ownEntityId: string | undefined, targetId: string): boolean {
    if (isAdminLike(role)) {
        return true;
    }

    return !!ownEntityId && ownEntityId === targetId;
}
