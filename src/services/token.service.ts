import User from "../models/user.model";
import jwt from "jsonwebtoken";

/**
 * Сервис для управления refresh токенами
 */
export class TokenService {
    private static readonly JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "superrefreshsecret";

    /**
     * Очищает все истекшие refresh токены из базы данных
     */
    static async cleanupExpiredTokens(): Promise<void> {
        try {
            console.log("🧹 Начинаем очистку истекших refresh токенов...");
            
            const users = await User.find({ refreshTokens: { $exists: true, $not: { $size: 0 } } });
            let totalCleaned = 0;

            for (const user of users) {
                if (!user.refreshTokens || user.refreshTokens.length === 0) continue;

                const validTokens: string[] = [];
                
                for (const token of user.refreshTokens) {
                    try {
                        // Проверяем, не истек ли токен
                        jwt.verify(token, this.JWT_REFRESH_SECRET);
                        validTokens.push(token);
                    } catch (error) {
                        // Токен истек или невалиден, не добавляем его в validTokens
                        totalCleaned++;
                    }
                }

                // Обновляем пользователя только если есть изменения
                if (validTokens.length !== user.refreshTokens.length) {
                    await User.findByIdAndUpdate(user._id, {
                        $set: { refreshTokens: validTokens }
                    });
                }
            }

            console.log(`✅ Очистка завершена. Удалено ${totalCleaned} истекших токенов`);
        } catch (error) {
            console.error("❌ Ошибка при очистке токенов:", error);
        }
    }

    /**
     * Получает статистику по активным токенам
     */
    static async getTokenStatistics(): Promise<{
        totalUsers: number;
        usersWithTokens: number;
        totalTokens: number;
        averageTokensPerUser: number;
    }> {
        const totalUsers = await User.countDocuments();
        
        const usersWithTokens = await User.countDocuments({
            refreshTokens: { $exists: true, $not: { $size: 0 } }
        });

        const tokenStats = await User.aggregate([
            { $match: { refreshTokens: { $exists: true } } },
            {
                $group: {
                    _id: null,
                    totalTokens: { $sum: { $size: "$refreshTokens" } }
                }
            }
        ]);

        const totalTokens = tokenStats.length > 0 ? tokenStats[0].totalTokens : 0;
        const averageTokensPerUser = usersWithTokens > 0 ? totalTokens / usersWithTokens : 0;

        return {
            totalUsers,
            usersWithTokens,
            totalTokens,
            averageTokensPerUser: Math.round(averageTokensPerUser * 100) / 100
        };
    }

    /**
     * Ограничивает количество активных токенов для пользователя (например, макс 5 устройств)
     */
    static async limitUserTokens(userId: string, maxTokens: number = 5): Promise<void> {
        const user = await User.findById(userId);
        
        if (!user || !user.refreshTokens || user.refreshTokens.length <= maxTokens) {
            return;
        }

        // Оставляем только последние N токенов (самые новые)
        const limitedTokens = user.refreshTokens.slice(-maxTokens);
        
        await User.findByIdAndUpdate(userId, {
            $set: { refreshTokens: limitedTokens }
        });

        console.log(`🔒 Ограничено количество токенов для пользователя ${userId}: ${user.refreshTokens.length} -> ${maxTokens}`);
    }
}

/**
 * Запускает периодическую очистку истекших токенов (каждые 24 часа)
 */
export function startTokenCleanupScheduler(): void {
    // Очистка каждые 24 часа
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах
    
    console.log("⏰ Запуск планировщика очистки токенов (каждые 24 часа)");
    
    // Первая очистка через час после запуска
    setTimeout(() => {
        TokenService.cleanupExpiredTokens();
    }, 60 * 60 * 1000);
    
    // Затем каждые 24 часа
    setInterval(() => {
        TokenService.cleanupExpiredTokens();
    }, CLEANUP_INTERVAL);
}

export default TokenService;