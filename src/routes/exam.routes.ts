import express from "express";
import { createExam, deleteAllExams, deleteExam, getExams, getExamsForFilter, getResultsTemplate, updateExam } from "../controllers/exam.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(authMiddleware([]), getExams)
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createExam)
    .delete(canDelete, deleteAllExams);
router.route("/:id")
    .put(authMiddleware(["superadmin"]), updateExam)
    .delete(canDelete, deleteExam);
router.route("/filter")
    .get(authMiddleware([]), getExamsForFilter)
// IMTAHAN_NOVLERI_TASK.md §7 — тот же доступ, что и на импорт результатов (studentResult.routes.ts /upload).
router.route("/:id/results-template.xlsx")
    .get(authMiddleware(["superadmin", "admin", "moderator"]), getResultsTemplate);

export default router;