import express from "express";
import { previewGradePromotion, executeGradePromotion, previewClosure, executeClosure } from "../controllers/gradePromotion.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/promotion")
    .get(authMiddleware(["superadmin", "admin"]), previewGradePromotion)
    .post(authMiddleware(["superadmin", "admin"]), executeGradePromotion);

// ACADEMIC_YEAR_ARCHIVE_TASK.md §3.5 — закрытие учебного года. Правильный порядок для
// админа: сначала /closure, потом /promotion (см. §3.2).
router.route("/closure")
    .get(authMiddleware(["superadmin", "admin"]), previewClosure)
    .post(authMiddleware(["superadmin", "admin"]), executeClosure);

export default router;
