import fs from 'fs';
import path from 'path';
import { Model, Document } from 'mongoose';
import { pg } from '../config/pg';

/** Таблицы с колонкой avatar_url — те же 4 сущности, что и в Mongo-версии ниже. */
type AvatarTable = 'districts' | 'schools' | 'teachers' | 'students';

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
