import express from "express";
import { previewGradePromotion, executeGradePromotion } from "../controllers/gradePromotion.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/promotion")
    .get(authMiddleware(["superadmin", "admin"]), previewGradePromotion)
    .post(authMiddleware(["superadmin", "admin"]), executeGradePromotion);

export default router;
