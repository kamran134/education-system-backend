import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import User from "../models/user.model";
import TokenService from "../services/token.service";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "superrefreshsecret";

// Refresh токены теперь хранятся в MongoDB в коллекции пользователей

const generateTokens = (userId: string, role: string, districtId?: string, schoolId?: string, teacherId?: string, studentId?: string) => {
    const payload: any = { userId, role };
    
    // Add entity IDs based on role
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
        const user = await User.findOne({ email });
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
            String(user._id), 
            user.role,
            user.districtId ? String(user.districtId) : undefined,
            user.schoolId ? String(user.schoolId) : undefined,
            user.teacherId ? String(user.teacherId) : undefined,
            user.studentId ? String(user.studentId) : undefined
        );
        
        console.log('[LOGIN] Generated tokens for user:', user.email);
        
        // Сохраняем refresh token в базе данных и обновляем время последнего входа
        await User.findByIdAndUpdate(user._id, {
            $push: { refreshTokens: refreshToken },
            lastLoginAt: new Date()
        });
        
        console.log('[LOGIN] Saved refresh token to database');

        // Ограничиваем количество активных сессий (максимум 5 устройств)
        await TokenService.limitUserTokens(String(user._id), 5);

        // Устанавливаем refresh token в httpOnly cookie
        const cookieOptions: any = {
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
                    id: user._id,
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
    const userWithToken = await User.findOne({ refreshTokens: refreshToken });
    
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
            await User.findByIdAndUpdate(userWithToken._id, {
                $pull: { refreshTokens: refreshToken }
            });
            
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
            String(userWithToken._id), 
            userWithToken.role,
            userWithToken.districtId ? String(userWithToken.districtId) : undefined,
            userWithToken.schoolId ? String(userWithToken.schoolId) : undefined,
            userWithToken.teacherId ? String(userWithToken.teacherId) : undefined,
            userWithToken.studentId ? String(userWithToken.studentId) : undefined
        );
        
        console.log('[REFRESH TOKEN] Updating tokens in database...');
        // Сначала удаляем старый refresh token
        await User.findByIdAndUpdate(userWithToken._id, {
            $pull: { refreshTokens: refreshToken }
        });
        
        // Затем добавляем новый refresh token
        await User.findByIdAndUpdate(userWithToken._id, {
            $push: { refreshTokens: newRefreshToken }
        });

        console.log('[REFRESH TOKEN] Setting new refresh token cookie...');
        // Обновляем refresh token cookie
        const cookieOptions: any = {
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
            await User.findByIdAndUpdate(userWithToken._id, {
                $pull: { refreshTokens: refreshToken }
            });
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
        const user = await User.findById(req.user?.userId).select("-passwordHash");
        if (!user) {
            res.status(404).json({ 
                success: false,
                message: "İstifadəçi tapılmadı!" 
            });
            return;
        }

        res.json({ 
            success: true,
            data: {
                id: user._id,
                email: user.email,
                role: user.role,
                isApproved: user.isApproved
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
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            res.status(400).json({ message: "İstifadəçi artıq mövcuddur!" });
            return;
        }

        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        if (!password || typeof password !== "string" || password.trim().length < 6) {
            res.status(400).json({ message: "Parol təqdim edilməyib və ya düzgün formatda deyil!" });
            return;
        }

        const passwordHash = await bcrypt.hash(password.toString(), 10);
        const newUser = new User({
            email, passwordHash, role: role || 'user', isApproved: role === "superadmin"
        });

        await newUser.save();
        res.status(201).json({ message: "İstifadəçi qeydiyyatdan keçdi. Təsdiq gözlənilir." })
    } catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
}

export const approveUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const user = await User.findByIdAndUpdate(id, { isApproved: true }, { new: true });
        if (!user) {
            res.status(404).json({ message: "İstifadəçi tapılmadı!" });
            return;
        }

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

    const role = await User.findById(userId).select("role");
    if (!role) {
        res.status(404).json({ message: "İstifadəçi rolu tapılmadı!" });
        return;
    }

    res.json({ role: role.role });
}

export const logout = async (req: Request, res: Response) => {
    try {
        const { refreshToken } = req.cookies;
        
        if (refreshToken) {
            // Удаляем токен из базы данных
            await User.updateOne(
                { refreshTokens: refreshToken },
                { $pull: { refreshTokens: refreshToken } }
            );
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
        await User.findByIdAndUpdate(userId, {
            $set: { refreshTokens: [] }
        });
        
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

        const user = await User.findById(userId).select('refreshTokens lastLoginAt');
        
        if (!user) {
            res.status(404).json({ 
                success: false,
                message: "İstifadəçi tapılmadı!" 
            });
            return;
        }

        res.json({ 
            success: true,
            data: {
                activeSessionsCount: user.refreshTokens?.length || 0,
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
        const stats = await TokenService.getTokenStatistics();
        
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
        await TokenService.cleanupExpiredTokens();
        
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