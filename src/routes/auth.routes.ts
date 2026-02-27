import express from "express";
import rateLimit from "express-rate-limit";
import { login, register, approveUser, logout, checkRole, refreshToken, me, logoutFromAllDevices, getActiveSessions, getTokenStatistics, forceCleanupTokens } from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// Строгий лимит только для логина (защита от брутфорса)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 10, // Максимум 10 попыток логина за 15 минут
    message: { success: false, message: 'Çox sayda giriş cəhdi. Zəhmət olmasa 15 dəqiqə gözləyin.' },
    skipSuccessfulRequests: true, // Не считаем успешные попытки
    standardHeaders: true,
    legacyHeaders: false,
});

router.get("/check-role/:id", checkRole);
router.post("/login", loginLimiter, login); // Применяем строгий лимит только к login
router.post("/register", register);
router.post("/approve/:id", authMiddleware(["superadmin", "admin"]), approveUser);
router.post("/logout", logout);
router.post("/logout-all", authMiddleware([]), logoutFromAllDevices);
router.post("/refresh", refreshToken);
router.get("/me", authMiddleware([]), me);
router.get("/sessions", authMiddleware([]), getActiveSessions);
router.get("/debug-cookies", authMiddleware(["superadmin"]), (req, res) => {
    console.log('[DEBUG] All cookies:', req.cookies);
    res.json({ 
        cookies: req.cookies, 
        hasRefreshToken: !!req.cookies.refreshToken,
        refreshTokenLength: req.cookies.refreshToken ? req.cookies.refreshToken.length : 0
    });
});

// Админские маршруты для управления токенами
router.get("/admin/token-stats", authMiddleware(["admin", "superadmin"]), getTokenStatistics);
router.post("/admin/cleanup-tokens", authMiddleware(["admin", "superadmin"]), forceCleanupTokens);

export default router;