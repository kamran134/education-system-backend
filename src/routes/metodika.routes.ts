import express from "express";
import { MetodikaController } from "../controllers/metodika.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();
const controller = new MetodikaController();

// GET — без authMiddleware: страница «İSİM metodikası» публичная, читается без авторизации,
// как /api/public/summary у лендинга (п.6 ТЗ от 04.09.2026).
router.route("/").get(controller.get).put(authMiddleware(["superadmin", "admin"]), controller.put).delete(authMiddleware(["superadmin", "admin"]), controller.delete);

export default router;
