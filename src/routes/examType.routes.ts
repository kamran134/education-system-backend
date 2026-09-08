import express from "express";
import { getExamTypes, createExamType, updateExamType, deleteExamType } from "../controllers/examType.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// IMTAHAN_NOVLERI_TASK.md §5.3: справочники (типы, предметы, шкалы) — admin/superadmin,
// как POST-ы /stats (см. stat.routes.ts).
router.route("/")
    .get(authMiddleware([]), getExamTypes)
    .post(authMiddleware(["superadmin", "admin"]), createExamType);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin"]), updateExamType)
    .delete(authMiddleware(["superadmin", "admin"]), deleteExamType);

export default router;
