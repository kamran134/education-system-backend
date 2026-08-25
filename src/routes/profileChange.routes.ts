import express from "express";
import {
    listProfileChangeQueue,
    getProfileChangeCount,
    getProfileChangePendingIds,
    getCurrentProfileChange,
    approveProfileChange,
    rejectProfileChange,
} from "../controllers/profileChange.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

// admin-like проверяется в контроллере (isAdminLike) — здесь только "авторизован", так же
// как у /:id/profile на school/teacher/district (BASE_FIXES_TASK.md §2.5).
router.route("/").get(authMiddleware([]), listProfileChangeQueue);
router.route("/count").get(authMiddleware([]), getProfileChangeCount);
router.route("/pending-ids").get(authMiddleware([]), getProfileChangePendingIds);
// admin-like ИЛИ владелец этой же сущности — проверяется в контроллере.
router.route("/current").get(authMiddleware([]), getCurrentProfileChange);
router.route("/:id/approve").post(authMiddleware([]), approveProfileChange);
router.route("/:id/reject").post(authMiddleware([]), rejectProfileChange);

export default router;
