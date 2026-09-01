import express from "express";
import { previewGradePromotion, executeGradePromotion, previewClosure, executeClosure, putRatingYear } from "../controllers/gradePromotion.controller";
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

// REYTINQ_ILI_TASK.md §7 — тумблер «Yeni tədris ili»: ручное включение показа текущего
// учебного года рейтингов на главных страницах.
router.route("/rating-year")
    .put(authMiddleware(["superadmin", "admin"]), putRatingYear);

export default router;
