import express from "express";
import { login, register, approveUser, logout, checkRole, refreshToken, me } from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.get("/check-role/:id", checkRole);
router.post("/login", login);
router.post("/register", register);
router.post("/approve/:id", authMiddleware(["superadmin"]), approveUser);
router.post("/logout", logout);
router.post("/refresh", refreshToken);
router.get("/me", authMiddleware([]), me);

export default router;