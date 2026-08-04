import jwt from "jsonwebtoken";
import { pg } from "../config/pg";
import { JWT_REFRESH_SECRET } from "../config/env";

/**
 * Postgres-версия TokenService. Mongo-версия (token.service.ts) хранила refreshTokens[]
 * массивом прямо на документе пользователя; здесь — отдельная таблица user_refresh_tokens
 * (db/schema.sql), лимит в 5 активных сессий остаётся тем же бизнес-правилом, просто
 * реализован через DELETE/ORDER BY created_at вместо array.slice().
 */
export class TokenServicePg {
    static async addToken(userId: number, token: string): Promise<void> {
        await pg.insertInto("user_refresh_tokens").values({ user_id: userId, token }).execute();
    }

    static async removeToken(token: string): Promise<void> {
        await pg.deleteFrom("user_refresh_tokens").where("token", "=", token).execute();
    }

    static async clearAllTokensForUser(userId: number): Promise<void> {
        await pg.deleteFrom("user_refresh_tokens").where("user_id", "=", userId).execute();
    }

    static async countTokensForUser(userId: number): Promise<number> {
        const row = await pg
            .selectFrom("user_refresh_tokens")
            .select(({ fn }) => [fn.countAll().as("count")])
            .where("user_id", "=", userId)
            .executeTakeFirstOrThrow();
        return Number(row.count);
    }

    /**
     * Атомарная замена старого refresh-токена новым — аналог Mongo
     * findOneAndUpdate({_id, refreshTokens: old}, {$set: {'refreshTokens.$': new}}).
     * Если строка с old уже удалена параллельным запросом, добавляет new как новую запись
     * (то же поведение отката, что было в auth.controller.ts на Mongo).
     */
    static async replaceToken(userId: number, oldToken: string, newToken: string): Promise<void> {
        const result = await pg
            .updateTable("user_refresh_tokens")
            .set({ token: newToken })
            .where("user_id", "=", userId)
            .where("token", "=", oldToken)
            .executeTakeFirst();

        if (Number(result.numUpdatedRows) === 0) {
            await this.addToken(userId, newToken);
        }
    }

    /**
     * Находит пользователя по refresh-токену (JOIN вместо Mongo User.findOne({refreshTokens: token})).
     */
    static async findUserIdByToken(token: string): Promise<number | null> {
        const row = await pg
            .selectFrom("user_refresh_tokens")
            .select("user_id")
            .where("token", "=", token)
            .executeTakeFirst();
        return row?.user_id ?? null;
    }

    /**
     * Ограничивает количество активных токенов для пользователя (макс 5 устройств).
     * Оставляет самые новые (по created_at), удаляет остальные.
     */
    static async limitUserTokens(userId: number, maxTokens: number = 5): Promise<void> {
        const tokens = await pg
            .selectFrom("user_refresh_tokens")
            .select("id")
            .where("user_id", "=", userId)
            .orderBy("created_at", "desc")
            .execute();

        if (tokens.length <= maxTokens) return;

        const idsToDelete = tokens.slice(maxTokens).map((t) => t.id);
        await pg.deleteFrom("user_refresh_tokens").where("id", "in", idsToDelete).execute();

        console.log(`🔒 Ограничено количество токенов для пользователя ${userId}: ${tokens.length} -> ${maxTokens}`);
    }

    /**
     * Очищает все истекшие refresh токены из базы данных.
     */
    static async cleanupExpiredTokens(): Promise<void> {
        try {
            console.log("🧹 Начинаем очистку истекших refresh токенов...");

            const rows = await pg.selectFrom("user_refresh_tokens").select(["id", "token"]).execute();
            const expiredIds: number[] = [];

            for (const row of rows) {
                try {
                    jwt.verify(row.token, JWT_REFRESH_SECRET);
                } catch {
                    expiredIds.push(row.id);
                }
            }

            if (expiredIds.length > 0) {
                await pg.deleteFrom("user_refresh_tokens").where("id", "in", expiredIds).execute();
            }

            console.log(`✅ Очистка завершена. Удалено ${expiredIds.length} истекших токенов`);
        } catch (error) {
            console.error("❌ Ошибка при очистке токенов:", error);
        }
    }

    /**
     * Получает статистику по активным токенам.
     */
    static async getTokenStatistics(): Promise<{
        totalUsers: number;
        usersWithTokens: number;
        totalTokens: number;
        averageTokensPerUser: number;
    }> {
        const [{ count: totalUsers }] = await pg
            .selectFrom("users")
            .select(({ fn }) => [fn.countAll().as("count")])
            .execute();

        const [{ count: usersWithTokens }] = await pg
            .selectFrom("user_refresh_tokens")
            .select(({ fn }) => [fn.count("user_id").distinct().as("count")])
            .execute();

        const [{ count: totalTokens }] = await pg
            .selectFrom("user_refresh_tokens")
            .select(({ fn }) => [fn.countAll().as("count")])
            .execute();

        const totalTokensNum = Number(totalTokens);
        const usersWithTokensNum = Number(usersWithTokens);
        const averageTokensPerUser = usersWithTokensNum > 0 ? totalTokensNum / usersWithTokensNum : 0;

        return {
            totalUsers: Number(totalUsers),
            usersWithTokens: usersWithTokensNum,
            totalTokens: totalTokensNum,
            averageTokensPerUser: Math.round(averageTokensPerUser * 100) / 100,
        };
    }
}

/**
 * Запускает периодическую очистку истекших токенов (каждые 24 часа).
 */
export function startTokenCleanupScheduler(): void {
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

    console.log("⏰ Запуск планировщика очистки токенов (каждые 24 часа)");

    setTimeout(() => {
        TokenServicePg.cleanupExpiredTokens();
    }, 60 * 60 * 1000);

    setInterval(() => {
        TokenServicePg.cleanupExpiredTokens();
    }, CLEANUP_INTERVAL);
}

export default TokenServicePg;
