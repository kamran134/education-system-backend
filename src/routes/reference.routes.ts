import express from "express";
import { getLevelsReference, getSubjectsReference, getRatingYearReference } from "../controllers/reference.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/levels").get(authMiddleware([]), getLevelsReference);
router.route("/subjects").get(authMiddleware([]), getSubjectsReference);
router.route("/rating-year").get(authMiddleware([]), getRatingYearReference);

export default router;
