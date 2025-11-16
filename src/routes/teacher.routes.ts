import express from "express";
import multer from "multer";
import { createAllTeachers, createTeacher, deleteTeacher, deleteTeachers, getTeacherById, getTeachers, getTeachersForFilter, repairTeachers, updateTeacher, updateTeachersStats } from "../controllers/teacher.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

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

export default router;