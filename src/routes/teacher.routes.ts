import express from "express";
import multer from "multer";
import { createAllTeachers, createTeacher, deleteTeacher, deleteTeachers, getTeacherById, getTeachers, getTeachersForFilter, repairTeachers, updateTeacher, updateTeachersStats, importLegacyTeachers, uploadTeacherAvatar, deleteTeacherAvatar } from "../controllers/teacher.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";
import { teacherAvatarUpload } from "../config/multer";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.route("/")
    .get(authMiddleware([]), getTeachers) // Allow all authenticated users
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createTeacher);
router.route("/filter")
    .get(authMiddleware([]), getTeachersForFilter); // Allow all authenticated users
router.route("/search")
    .get(authMiddleware([]), getTeachers); // Allow all authenticated users
router.route("/upload")
    .post(upload.single("file"), authMiddleware(["superadmin", "admin"]), createAllTeachers);
router.route("/legacy-import")
    .post(upload.single("file"), authMiddleware(["superadmin", "admin"]), importLegacyTeachers);
router.route("/repair")
    .get(authMiddleware(["superadmin", "admin"]), repairTeachers);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateTeachersStats);
router.route("/delete/:teacherIds")
    .delete(canDelete, deleteTeachers);
router.route("/:id")
    .get(authMiddleware([]), getTeacherById) // Allow all authenticated users
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateTeacher)
    .delete(canDelete, deleteTeacher);
router.route("/:id/avatar")
    .post(authMiddleware([]), teacherAvatarUpload.single('avatar'), uploadTeacherAvatar) // owner or admin, checked in controller
    .delete(authMiddleware([]), deleteTeacherAvatar);

export default router;