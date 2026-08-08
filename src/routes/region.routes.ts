import express from "express";
import { createRegion, deleteRegion, getRegionById, getRegions, getRegionsForFilter, updateRegion, checkExistingRegionCodes, uploadRegionAvatar, deleteRegionAvatar } from "../controllers/region.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";
import { regionAvatarUpload } from "../config/multer";

const router = express.Router();

router.route("/")
    .get(authMiddleware([]), getRegions) // Allow all authenticated users
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createRegion);
router.route("/filter")
    .get(authMiddleware([]), getRegionsForFilter);
router.route("/check-codes")
    .post(authMiddleware(["superadmin", "admin", "moderator"]), checkExistingRegionCodes);
router.route("/:id")
    .get(authMiddleware([]), getRegionById) // Allow all authenticated users
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateRegion)
    .delete(canDelete, deleteRegion);
router.route("/:id/avatar")
    .post(authMiddleware([]), regionAvatarUpload.single('avatar'), uploadRegionAvatar) // owner or admin, checked in controller
    .delete(authMiddleware([]), deleteRegionAvatar);

export default router;
