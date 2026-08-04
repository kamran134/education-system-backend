import { sql } from "kysely";
import { pg } from "../config/pg";
import { Json } from "../types/db";

/**
 * Postgres-версия хранения пользовательских настроек столбцов таблиц.
 * Mongo-версия (userSettings.model.ts) хранила и "личные" настройки (userId = ObjectId),
 * и "глобальные" (userId = строка-sentinel 'global', один документ на всю систему,
 * читаемый всеми ролями — найдено на реальных данных при ETL, шаг 3 PG_MIGRATION_TASKS.md,
 * не мусор). В Postgres sentinel не нужен — `user_id IS NULL` и есть глобальная запись,
 * schema.sql уже заложила под это два частичных уникальных индекса:
 *   user_settings_user_id_key      — один ряд на реального пользователя (WHERE user_id IS NOT NULL)
 *   user_settings_global_singleton — ровно один глобальный ряд          (WHERE user_id IS NULL)
 */
export interface UserSettingsRow {
    id: number;
    userId: number | null;
    developingStudentCollumns: string[];
    studentCollumns: string[];
    allStudentCollumns: string[];
    allTeacherCollumns: string[];
    allSchoolCollumns: string[];
    allDistrictCollumns: string[];
    teacherViewCollumns: string[];
    directorViewCollumns: string[];
    districtViewCollumns: string[];
    studentViewCollumns: string[];
    roleSettings: Json;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserSettingsUpdate {
    developingStudentCollumns?: string[];
    studentCollumns?: string[];
    allStudentCollumns?: string[];
    allTeacherCollumns?: string[];
    allSchoolCollumns?: string[];
    allDistrictCollumns?: string[];
    teacherViewCollumns?: string[];
    directorViewCollumns?: string[];
    districtViewCollumns?: string[];
    studentViewCollumns?: string[];
    roleSettings?: Json;
}

function toColumns(data: Partial<UserSettingsUpdate>) {
    return {
        ...(data.developingStudentCollumns !== undefined && { developing_student_collumns: data.developingStudentCollumns }),
        ...(data.studentCollumns !== undefined && { student_collumns: data.studentCollumns }),
        ...(data.allStudentCollumns !== undefined && { all_student_collumns: data.allStudentCollumns }),
        ...(data.allTeacherCollumns !== undefined && { all_teacher_collumns: data.allTeacherCollumns }),
        ...(data.allSchoolCollumns !== undefined && { all_school_collumns: data.allSchoolCollumns }),
        ...(data.allDistrictCollumns !== undefined && { all_district_collumns: data.allDistrictCollumns }),
        ...(data.teacherViewCollumns !== undefined && { teacher_view_collumns: data.teacherViewCollumns }),
        ...(data.directorViewCollumns !== undefined && { director_view_collumns: data.directorViewCollumns }),
        ...(data.districtViewCollumns !== undefined && { district_view_collumns: data.districtViewCollumns }),
        ...(data.studentViewCollumns !== undefined && { student_view_collumns: data.studentViewCollumns }),
        ...(data.roleSettings !== undefined && { role_settings: data.roleSettings }),
    };
}

function toRow(row: {
    id: number; user_id: number | null;
    developing_student_collumns: string[]; student_collumns: string[]; all_student_collumns: string[];
    all_teacher_collumns: string[]; all_school_collumns: string[]; all_district_collumns: string[];
    teacher_view_collumns: string[]; director_view_collumns: string[]; district_view_collumns: string[];
    student_view_collumns: string[]; role_settings: Json; created_at: Date; updated_at: Date;
}): UserSettingsRow {
    return {
        id: row.id,
        userId: row.user_id,
        developingStudentCollumns: row.developing_student_collumns,
        studentCollumns: row.student_collumns,
        allStudentCollumns: row.all_student_collumns,
        allTeacherCollumns: row.all_teacher_collumns,
        allSchoolCollumns: row.all_school_collumns,
        allDistrictCollumns: row.all_district_collumns,
        teacherViewCollumns: row.teacher_view_collumns,
        directorViewCollumns: row.director_view_collumns,
        districtViewCollumns: row.district_view_collumns,
        studentViewCollumns: row.student_view_collumns,
        roleSettings: row.role_settings,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function getUserSettingsPg(userId: number): Promise<UserSettingsRow | null> {
    const row = await pg.selectFrom("user_settings").selectAll().where("user_id", "=", userId).executeTakeFirst();
    return row ? toRow(row) : null;
}

export async function getGlobalSettingsPg(): Promise<UserSettingsRow | null> {
    const row = await pg.selectFrom("user_settings").selectAll().where("user_id", "is", null).executeTakeFirst();
    return row ? toRow(row) : null;
}

/** upsert-семантика Mongo-версии (findOneAndUpdate + upsert:true) — по частичному индексу user_id. */
export async function upsertUserSettingsPg(userId: number, data: Partial<UserSettingsUpdate>): Promise<UserSettingsRow> {
    const columns = toColumns(data);
    const row = await pg
        .insertInto("user_settings")
        .values({ user_id: userId, ...columns })
        .onConflict((oc) => oc.column("user_id").where("user_id", "is not", null).doUpdateSet({ ...columns, updated_at: new Date() }))
        .returningAll()
        .executeTakeFirstOrThrow();
    return toRow(row);
}

/** upsert для единственного глобального ряда — конфликт по индексу-синглтону ((true)) WHERE user_id IS NULL. */
export async function upsertGlobalSettingsPg(data: Partial<UserSettingsUpdate>): Promise<UserSettingsRow> {
    const columns = toColumns(data);
    const row = await pg
        .insertInto("user_settings")
        .values({ user_id: null, ...columns })
        .onConflict((oc) => oc.expression(sql`(true)`).where("user_id", "is", null).doUpdateSet({ ...columns, updated_at: new Date() }))
        .returningAll()
        .executeTakeFirstOrThrow();
    return toRow(row);
}
