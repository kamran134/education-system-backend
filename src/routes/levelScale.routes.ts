import express from "express";
import { getLevelScales } from "../controllers/levelScale.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// IMTAHAN_NOVLERI_TASK.md §5.3: шкалы pillə — пока только чтение (редактор шкал — отдельная
// задача, §6). Доступ как остальным справочникам.
router.route("/").get(authMiddleware([]), getLevelScales);

export default router;
