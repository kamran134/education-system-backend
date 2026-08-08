import { Request, Response, CookieOptions } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import { userServicePg } from "../services/user.service.pg";
import TokenServicePg from "../services/token.service.pg";
import { JWT_SECRET, JWT_REFRESH_SECRET } from "../config/env";
import { buildProfileSummaryPg } from "../utils/profile-summary.util.pg";
import { pg } from "../config/pg";

// Refresh токены хранятся в Postgres, таблица user_refresh_tokens (см. token.service.pg.ts)

interface JwtPayload {
    userId: string;
    role: string;
    regionId?: string;
    districtId?: string;
    schoolId?: string;
    teacherId?: string;
    studentId?: string;
}

const generateTokens = (userId: string, role: string, regionId?: string, districtId?: string, schoolId?: string, teacherId?: string, studentId?: string) => {
    const payload: JwtPayload = { userId, role };

    // Add entity IDs based on role
    if (regionId) payload.regionId = regionId;
    if (districtId) payload.districtId = districtId;
    if (schoolId) payload.schoolId = schoolId;
    if (teacherId) payload.teacherId = teacherId;
    if (studentId) payload.studentId = studentId;

    const accessToken = jwt.sign(
        payload,
        JWT_SECRET,
        { expiresIn: "15m" } // Короткий срок для access token
    );

    const refreshToken = jwt.sign(
        payload,
        JWT_REFRESH_SECRET,
        { expiresIn: "7d" } // Долгий срок для refresh token
    );

    return { accessToken, refreshToken };
};

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    try {
        const user = await userServicePg.findByEmail(email);
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            res.status(400).json({
                success: false,
                message: "Yanlış məlumatlar!"
            });
            return;
        }

        if (!user?.isApproved) {
            res.status(403).json({
                success: false,
                message: "Adminin təsdiqi mütləqdir!"
            });
            return;
        }

        const { accessToken, refreshToken } = generateTokens(
            String(user.id),
            user.role,
            user.regionId ? String(user.regionId) : undefined,
            user.districtId ? String(user.districtId) : undefined,
            user.schoolId ? String(user.schoolId) : undefined,
            user.teacherId ? String(user.teacherId) : undefined,
            user.studentId ? String(user.studentId) : undefined
        );

        console.log('[LOGIN] Generated tokens for user:', user.email);

        // Сохраняем refresh token в базе данных и обновляем время последнего входа
        await TokenServicePg.addToken(user.id, refreshToken);
        await pg.updateTable("users").set({ last_login_at: new Date() }).where("id", "=", user.id).execute();

        console.log('[LOGIN] Saved refresh token to database');

        // Ограничиваем количество активных сессий (максимум 5 устройств)
        await TokenServicePg.limitUserTokens(user.id, 5);

        // Устанавливаем refresh token в httpOnly cookie
        const cookieOptions: CookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
            path: "/"
        };

        // В production указываем domain для работы с поддоменами
        if (process.env.NODE_ENV === "production") {
            cookieOptions.domain = ".kpm.az";
        }
        // В development НЕ указываем domain - так cookie будет работать для всех портов localhost

        res.cookie("refreshToken", refreshToken, cookieOptions);

        console.log('[LOGIN] Set refresh token cookie with sameSite:', process.env.NODE_ENV === "production" ? "none" : "lax");

        res.json({
            success: true,
            message: "Uğurlu avtorizasiya",
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    isApproved: user.isApproved
                },
                token: accessToken
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Serverdə xəta!"
        });
        console.error(error);
    }
};

// Новый эндпоинт для обновления токена
export const refreshToken = async (req: Request, res: Response) => {
    const { refreshToken } = req.cookies;

    console.log('[REFRESH TOKEN] Request received, token exists:', !!refreshToken);

    if (!refreshToken) {
        console.log('[REFRESH TOKEN] No refresh token found in cookies');
        res.status(401).json({
            success: false,
            message: "Refresh token yoxdur və ya düzgün deyil!"
        });
        return;
    }

    // Проверяем токен в базе данных
    const userId = await TokenServicePg.findUserIdByToken(refreshToken);
    const userWithToken = userId ? await userServicePg.findById(userId) : null;

    console.log('[REFRESH TOKEN] User found with token:', !!userWithToken);

    if (!userWithToken) {
        console.log('[REFRESH TOKEN] No user found with this refresh token');
        res.status(401).json({
            success: false,
            message: "Refresh token yoxdur və ya düzgün deyil!"
        });
        return;
    }

    try {
        console.log('[REFRESH TOKEN] Verifying token...');
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as { userId: string; role: string };
        console.log('[REFRESH TOKEN] Token verified, user ID:', decoded.userId);

        // Проверяем, что пользователь все еще существует и активен (дополнительная проверка)
        if (!userWithToken.isApproved) {
            // Удаляем токен из базы данных
            await TokenServicePg.removeToken(refreshToken);

            const clearOptions: any = { path: "/" };
            if (process.env.NODE_ENV === "production") {
                clearOptions.domain = ".kpm.az";
            }
            res.clearCookie("refreshToken", clearOptions);

            res.status(401).json({
                success: false,
                message: "İstifadəçi aktiv deyil!"
            });
            return;
        }

        console.log('[REFRESH TOKEN] Generating new tokens...');
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(
            String(userWithToken.id),
            userWithToken.role,
            userWithToken.regionId ? String(userWithToken.regionId) : undefined,
            userWithToken.districtId ? String(userWithToken.districtId) : undefined,
            userWithToken.schoolId ? String(userWithToken.schoolId) : undefined,
            userWithToken.teacherId ? String(userWithToken.teacherId) : undefined,
            userWithToken.studentId ? String(userWithToken.studentId) : undefined
        );

        console.log('[REFRESH TOKEN] Updating tokens in database...');
        // Атомарная замена старого токена на новый (предотвращает race condition)
        await TokenServicePg.replaceToken(userWithToken.id, refreshToken, newRefreshToken);

        console.log('[REFRESH TOKEN] Setting new refresh token cookie...');
        // Обновляем refresh token cookie
        const cookieOptions: CookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: "/"
        };

        if (process.env.NODE_ENV === "production") {
            cookieOptions.domain = ".kpm.az";
        }

        res.cookie("refreshToken", newRefreshToken, cookieOptions);

        console.log('[REFRESH TOKEN] Sending successful response...');
        res.json({
            success: true,
            data: {
                token: accessToken
            }
        });
    } catch (error) {
        console.log('[REFRESH TOKEN] Error occurred:', error);
        console.log('[REFRESH TOKEN] Error message:', error instanceof Error ? error.message : 'Unknown error');
        console.log('[REFRESH TOKEN] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        // Удаляем некорректный токен из базы данных
        if (userWithToken) {
            await TokenServicePg.removeToken(refreshToken);
        }

        const clearOptions: any = { path: "/" };
        if (process.env.NODE_ENV === "production") {
            clearOptions.domain = ".kpm.az";
        }
        res.clearCookie("refreshToken", clearOptions);

        res.status(401).json({
            success: false,
            message: "Düzgün olmayan refresh token!"
        });
    }
};

// Эндпоинт для проверки текущего пользователя
export const me = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.userId ? parseInt(req.user.userId, 10) : NaN;
        const user = await userServicePg.findById(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı!"
            });
            return;
        }

        const profile = await buildProfileSummaryPg(user);

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                role: user.role,
                isApproved: user.isApproved,
                profile
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Serverdə xəta!"
        });
    }
};

export const register = async (req: Request, res: Response) => {
    const { email, password, role } = req.body;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    try {
        const existingUser = await userServicePg.findByEmail(email);
        if (existingUser) {
            res.status(400).json({ message: "İstifadəçi artıq mövcuddur!" });
            return;
        }

        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const pw = password?.toString() ?? '';
        if (!pw || pw.trim().length < 8 || !/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) {
            res.status(400).json({ message: "Parol ən azı 8 simvol olmalı, hərf və rəqəm daxil etməlidir!" });
            return;
        }

        const passwordHash = await bcrypt.hash(password.toString(), 10);
        // Mongo-версия дефолтила role на 'user' — значение, которого никогда не было в её же
        // enum (см. находки шага 3, PG_MIGRATION_TASKS.md: единственная реальная запись с role='user'
        // перенесена в Postgres как 'admin'). Postgres CHECK на users.role его тоже не пропустит.
        // Дефолт исправлен на 'student', как в самой схеме (db/schema.sql) — сознательное отличие,
        // не молчаливое: без роли в форме регистрации 'student' и был подразумеваемым намерением.
        await userServicePg.create({
            email, passwordHash, role: role || 'student', isApproved: role === "superadmin"
        });

        res.status(201).json({ message: "İstifadəçi qeydiyyatdan keçdi. Təsdiq gözlənilir." })
    } catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
}

export const approveUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const existing = await userServicePg.findById(parseInt(id, 10));
        if (!existing) {
            res.status(404).json({ message: "İstifadəçi tapılmadı!" });
            return;
        }

        const user = await userServicePg.approveUser(parseInt(id, 10));
        res.json({ message: "İstifadəçi təsdiq edildi!", user });
    } catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
}

export const checkRole = async (req: Request, res: Response) => {
    const userId = req.params.id;

    console.log("Checking role for user ID:", userId);

    if (!userId) {
        res.status(401).json({ message: "İstifadəçi tapılmadı!" });
        return;
    }

    const user = await userServicePg.findById(parseInt(userId, 10));
    if (!user) {
        res.status(404).json({ message: "İstifadəçi rolu tapılmadı!" });
        return;
    }

    res.json({ role: user.role });
}

export const logout = async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.cookies;

        if (refreshToken) {
            // Удаляем токен из базы данных
            await TokenServicePg.removeToken(refreshToken);
        }

        const clearOptions: any = { path: "/" };
        if (process.env.NODE_ENV === "production") {
            clearOptions.domain = ".kpm.az";
        }

        res.clearCookie("refreshToken", clearOptions);
        res.json({
            success: true,
            message: "Çıxış edildi!"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Çıxış zamanı xəta!"
        });
        console.error(error);
    }
};

// Выход из всех устройств (удаляет все refresh токены пользователя)
export const logoutFromAllDevices = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.userId;  // Из middleware авторизации

        if (!userId) {
            res.status(401).json({
                success: false,
                message: "Avtorizasiya tələb olunur!"
            });
            return;
        }

        // Удаляем все refresh токены пользователя
        await TokenServicePg.clearAllTokensForUser(parseInt(userId, 10));

        const clearOptions: any = { path: "/" };
        if (process.env.NODE_ENV === "production") {
            clearOptions.domain = ".kpm.az";
        }
        res.clearCookie("refreshToken", clearOptions);

        res.json({
            success: true,
            message: "Bütün cihazlardan çıxış edildi!"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Çıxış zamanı xəta!"
        });
        console.error(error);
    }
};

// Получить информацию об активных сессиях
export const getActiveSessions = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: "Avtorizasiya tələb olunur!"
            });
            return;
        }

        const id = parseInt(userId, 10);
        const user = await userServicePg.findById(id);

        if (!user) {
            res.status(404).json({
                success: false,
                message: "İstifadəçi tapılmadı!"
            });
            return;
        }

        const activeSessionsCount = await TokenServicePg.countTokensForUser(id);

        res.json({
            success: true,
            data: {
                activeSessionsCount,
                lastLoginAt: user.lastLoginAt,
                currentSession: !!req.cookies.refreshToken
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Sessiya məlumatları alınarkən xəta!"
        });
        console.error(error);
    }
};

// Админский эндпоинт для статистики токенов
export const getTokenStatistics = async (req: Request, res: Response) => {
    try {
        const stats = await TokenServicePg.getTokenStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Token statistikası alınarkən xəta!"
        });
        console.error(error);
    }
};

// Админский эндпоинт для принудительной очистки токенов
export const forceCleanupTokens = async (req: Request, res: Response) => {
    try {
        await TokenServicePg.cleanupExpiredTokens();

        res.json({
            success: true,
            message: "Köhnə tokenlər təmizləndi!"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Token təmizlənməsi zamanı xəta!"
        });
        console.error(error);
    }
};
