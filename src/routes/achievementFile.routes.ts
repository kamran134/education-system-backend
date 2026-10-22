import express from "express";
import {
    listAchievementFilesHandler,
    uploadAchievementFileHandler,
    deleteAchievementFileHandler,
    cancelAchievementFileRemovalHandler,
    requireAchievementManager,
} from "../controllers/achievementFile.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { uploadAchievementFile } from "../config/multer";

const router = express.Router();

// The signed GET /:id/content is mounted in index.ts, before the rate limiter (no Bearer on <img>).
// Order on upload matters: auth -> rights/limit gate -> multer, so nothing is written to disk for
// an anonymous or foreign request. Per-entity rights are checked in the gate/controller.
// Declared before /:entityType/:entityId: both are two-segment POSTs and would otherwise collide.
router.route("/:id/cancel-removal")
    .post(authMiddleware([]), cancelAchievementFileRemovalHandler);
router.route("/:entityType/:entityId")
    .get(authMiddleware([]), listAchievementFilesHandler)
    .post(authMiddleware([]), requireAchievementManager, uploadAchievementFile, uploadAchievementFileHandler);
router.route("/:id")
    .delete(authMiddleware([]), deleteAchievementFileHandler);

export default router;
