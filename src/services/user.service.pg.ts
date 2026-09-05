import bcrypt from "bcrypt";
import { sql } from "kysely";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, BulkOperationResult } from "../types/common.types";

export interface User {
    id: number;
    email: string;
    passwordHash: string;
    role: string;
    isApproved: boolean;
    lastLoginAt: Date | null;
    regionId: number | null;
    districtId: number | null;
    schoolId: number | null;
    teacherId: number | null;
    studentId: number | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserCreate {
    email: string;
    passwordHash: string;
    role?: string;
    isApproved?: boolean;
    regionId?: number | null;
    districtId?: number | null;
    schoolId?: number | null;
    teacherId?: number | null;
    studentId?: number | null;
}

/**
 * Postgres-версия UserService. Публичный контракт совпадает с Mongo-версией
 * (user.service.ts) — см. её для сравнения. Отличия намеренные:
 *   - id — число, не ObjectId (решение 04.08.2026, PG_MIGRATION_TASKS.md шаг 8).
 *   - districtId/schoolId/teacherId/studentId — настоящие FK (users.district_id и т.д.
 *     REFERENCES ... ). Postgres бросит ошибку, если указать несуществующую сущность,
 *     вместо того чтобы молча сохранить висячую ссылку, как было возможно в Mongo
 *     (см. находки шага 3 — 5 таких пользователей уже было в проде).
 *   - refreshTokens — вынесены в отдельную таблицу user_refresh_tokens
 *     (см. token.service.pg.ts), не массив на самой записи пользователя.
 */
export class UserServicePg {
    async findById(id: number): Promise<User | null> {
        const row = await pg.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
        return row ? this.toUser(row) : null;
    }

    async findByEmail(email: string): Promise<User | null> {
        const row = await pg.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst();
        return row ? this.toUser(row) : null;
    }

    async create(userData: UserCreate): Promise<User> {
        const row = await pg
            .insertInto("users")
            .values({
                email: userData.email,
                password_hash: userData.passwordHash,
                role: userData.role ?? "student",
                is_approved: userData.isApproved ?? false,
                region_id: userData.regionId ?? null,
                district_id: userData.districtId ?? null,
                school_id: userData.schoolId ?? null,
                teacher_id: userData.teacherId ?? null,
                student_id: userData.studentId ?? null,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return this.toUser(row);
    }

    async update(id: number, updateData: Partial<UserCreate>): Promise<User> {
        const row = await pg
            .updateTable("users")
            .set({
                ...(updateData.email !== undefined && { email: updateData.email }),
                ...(updateData.passwordHash !== undefined && { password_hash: updateData.passwordHash }),
                ...(updateData.role !== undefined && { role: updateData.role }),
                ...(updateData.isApproved !== undefined && { is_approved: updateData.isApproved }),
                ...(updateData.regionId !== undefined && { region_id: updateData.regionId }),
                ...(updateData.districtId !== undefined && { district_id: updateData.districtId }),
                ...(updateData.schoolId !== undefined && { school_id: updateData.schoolId }),
                ...(updateData.teacherId !== undefined && { teacher_id: updateData.teacherId }),
                ...(updateData.studentId !== undefined && { student_id: updateData.studentId }),
                updated_at: new Date(),
            })
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirst();

        if (!row) throw new Error("User not found");
        return this.toUser(row);
    }

    async delete(id: number): Promise<void> {
        const result = await pg.deleteFrom("users").where("id", "=", id).executeTakeFirst();
        if (Number(result.numDeletedRows) === 0) throw new Error("User not found");
    }

    async deleteBulk(ids: number[]): Promise<BulkOperationResult> {
        if (ids.length === 0) return { insertedCount: 0, modifiedCount: 0, deletedCount: 0, errors: [] };
        const result = await pg.deleteFrom("users").where("id", "in", ids).executeTakeFirst();
        return { insertedCount: 0, modifiedCount: 0, deletedCount: Number(result.numDeletedRows), errors: [] };
    }

    async getFilteredUsers(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<{ data: User[]; totalCount: number }> {
        // Привязка пользователя к району/школе/учителю зависит от роли и лежит в разных местах:
        // у директора школа сразу в users.school_id, у учителя — только в teachers.school_id/
        // district_id (в users эти поля у него обычно пустые), у ученика — в students. Поэтому
        // фильтруем по «эффективной» привязке через LEFT JOIN + COALESCE, а не по одной колонке
        // users. Джойны подключаем, только если реально задан хотя бы один из district/school/
        // teacherIds — остальным запросам (их большинство) лишние JOIN'ы по users не нужны.
        const needsJoins = !!(filters.districtIds?.length || filters.schoolIds?.length || filters.teacherIds?.length);

        const buildBase = () => {
            let q = pg.selectFrom("users") as any;
            if (needsJoins) {
                q = q
                    .leftJoin("schools as sc", "sc.id", "users.school_id")
                    .leftJoin("teachers as t", "t.id", "users.teacher_id")
                    .leftJoin("students as st", "st.id", "users.student_id");
            }
            return q;
        };

        const applyFilter = <Q extends { where: any }>(query: Q): Q => {
            let q = query;
            if (filters.active !== undefined) q = q.where("users.is_approved" as any, "=", filters.active);
            if (filters.role) q = q.where("users.role" as any, "=", filters.role);
            if (needsJoins) {
                if (filters.districtIds?.length) {
                    q = q.where(sql`coalesce(users.district_id, sc.district_id, t.district_id, st.district_id)`, "in", filters.districtIds) as Q;
                }
                if (filters.schoolIds?.length) {
                    q = q.where(sql`coalesce(users.school_id, t.school_id, st.school_id)`, "in", filters.schoolIds) as Q;
                }
                if (filters.teacherIds?.length) {
                    q = q.where(sql`coalesce(users.teacher_id, st.teacher_id)`, "in", filters.teacherIds) as Q;
                }
            }
            return q;
        };

        const sortColumn = this.mapSortColumn(sort.sortColumn);
        // selectAll("users") вместо selectAll() — при джойнах голый selectAll() тащит колонки
        // schools/teachers/students тоже, а у них есть свои "id"/"district_id" и т.п., которые
        // затирают одноимённые колонки users в результирующей строке, и toUser() получает чужие поля.
        let query = applyFilter(buildBase().selectAll("users"));
        query = query.orderBy(sortColumn, sort.sortDirection) as typeof query;

        const [rows, countRow] = await Promise.all([
            query.limit(pagination.size).offset(pagination.skip).execute(),
            applyFilter(buildBase())
                .select(({ fn }: any) => [fn.countAll().as("count")])
                .executeTakeFirstOrThrow(),
        ]);

        return { data: rows.map((r: any) => this.toUser(r)), totalCount: Number(countRow.count) };
    }

    async approveUser(id: number): Promise<User> {
        return this.update(id, { isApproved: true } as Partial<UserCreate>);
    }

    async changePassword(id: number, newPassword: string): Promise<void> {
        const passwordHash = await bcrypt.hash(newPassword, 10);
        const result = await pg
            .updateTable("users")
            .set({ password_hash: passwordHash, updated_at: new Date() })
            .where("id", "=", id)
            .executeTakeFirst();
        if (Number(result.numUpdatedRows) === 0) throw new Error("User not found");
    }

    async changeRole(id: number, role: string): Promise<User> {
        return this.update(id, { role });
    }

    private mapSortColumn(column: string): "email" | "role" | "is_approved" | "last_login_at" | "created_at" {
        const map: Record<string, any> = {
            email: "email", role: "role", isApproved: "is_approved",
            lastLoginAt: "last_login_at", createdAt: "created_at",
        };
        return map[column] ?? "email";
    }

    private toUser(row: {
        id: number; email: string; password_hash: string; role: string; is_approved: boolean;
        last_login_at: Date | null; region_id: number | null; district_id: number | null; school_id: number | null;
        teacher_id: number | null; student_id: number | null; created_at: Date; updated_at: Date;
    }): User {
        return {
            id: row.id,
            email: row.email,
            passwordHash: row.password_hash,
            role: row.role,
            isApproved: row.is_approved,
            lastLoginAt: row.last_login_at,
            regionId: row.region_id,
            districtId: row.district_id,
            schoolId: row.school_id,
            teacherId: row.teacher_id,
            studentId: row.student_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export const userServicePg = new UserServicePg();
