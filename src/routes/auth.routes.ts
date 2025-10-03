import express from "express";
import { login, register, approveUser, logout, checkRole, refreshToken, me, logoutFromAllDevices, getActiveSessions, getTokenStatistics, forceCleanupTokens } from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.get("/check-role/:id", checkRole);
router.post("/login", login);
router.post("/register", register);
router.post("/approve/:id", authMiddleware(["superadmin"]), approveUser);
router.post("/logout", logout);
router.post("/logout-all", authMiddleware([]), logoutFromAllDevices);
router.post("/refresh", refreshToken);
router.get("/me", authMiddleware([]), me);
router.get("/sessions", authMiddleware([]), getActiveSessions);
router.get("/debug-cookies", (req, res) => {
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