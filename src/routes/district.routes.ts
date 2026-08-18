import express from "express";
import { createAllDistricts, createDistrict, deleteDistrict, getDistrictById, getDistricts, getDistrictsForFilter, updateDistrict, updateDistrictProfile, updateDistrictsStats, uploadDistrictAvatar, deleteDistrictAvatar } from "../controllers/district.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";
import { districtAvatarUpload } from "../config/multer";

const router = express.Router();

router.route("/")
    .get(authMiddleware([]), getDistricts) // Allow all authenticated users
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createDistrict);
router.route("/filter")
    .get(authMiddleware([]), getDistrictsForFilter);
router.route("/search")
    .get(authMiddleware([]), getDistricts); // Allow all authenticated users
router.route("/addAll")
    .post(authMiddleware(["superadmin", "admin"]), createAllDistricts);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateDistrictsStats);
router.route("/:id")
    .get(authMiddleware([]), getDistrictById) // Allow all authenticated users
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateDistrict)
    .delete(canDelete, deleteDistrict);
router.route("/:id/avatar")
    .post(authMiddleware([]), districtAvatarUpload.single('avatar'), uploadDistrictAvatar) // owner or admin, checked in controller
    .delete(authMiddleware([]), deleteDistrictAvatar);
router.route("/:id/profile")
    .patch(authMiddleware([]), updateDistrictProfile); // owner (districtRepresenter) or admin, checked in controller

export default router;