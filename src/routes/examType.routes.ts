import express from "express";
import { getExamTypes, createExamType, updateExamType, deleteExamType, getResultsTemplateForSection } from "../controllers/examType.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// IMTAHAN_NOVLERI_TASK.md §5.3: справочники (типы, предметы, шкалы) — admin/superadmin,
// как POST-ы /stats (см. stat.routes.ts).
router.route("/")
    .get(authMiddleware([]), getExamTypes)
    .post(authMiddleware(["superadmin", "admin"]), createExamType);
// IMTAHAN_NOVLERI_TASK.md §18.1 — права как у GET /exam-types (любой авторизованный).
router.route("/:id/results-template.xlsx")
    .get(authMiddleware([]), getResultsTemplateForSection);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin"]), updateExamType)
    .delete(authMiddleware(["superadmin", "admin"]), deleteExamType);

export default router;
