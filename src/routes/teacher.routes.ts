import express from "express";
import multer from "multer";
import { createAllTeachers, createTeacher, deleteTeacher, deleteTeachers, getTeachers, getTeachersForFilter, repairTeachers, updateTeacher, updateTeachersStats } from "../controllers/teacher.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.route("/")
    .get(getTeachers)
    .post(authMiddleware(["superadmin", "admin"]), createTeacher);
router.route("/filter")
    .get(getTeachersForFilter);
router.route("/search")
    .get(authMiddleware(["superadmin", "admin"]), getTeachers); // For user creation search
router.route("/upload")
    .post(upload.single("file"), authMiddleware(["superadmin", "admin"]), createAllTeachers);
router.route("/repair")
    .get(authMiddleware(["superadmin", "admin"]), repairTeachers);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateTeachersStats);
router.route("/delete/:teacherIds")
    .delete(authMiddleware(["superadmin", "admin"]), deleteTeachers);
router.route("/:id")
    .put(authMiddleware(["superadmin", "admin"]), updateTeacher)
    .delete(authMiddleware(["superadmin", "admin"]), deleteTeacher);

export default router;