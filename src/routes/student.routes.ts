import express from "express";
import { getStudents, getStudent, deleteAllStudents, deleteStudent, deleteStudents, searchStudents, repairStudents, updateStudent, createStudent } from "../controllers/student.controller";
import { authMiddleware, canDelete } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(authMiddleware([]), getStudents) // Allow all authenticated users
    .post(authMiddleware(["superadmin", "admin", "moderator"]), createStudent)
    .delete(canDelete, deleteAllStudents);
router.route("/repair")
    .get(authMiddleware(["superadmin", "admin"]), repairStudents);
// router.route("/forStats")
//     .get(getStudentsForStats);
router.route("/search/:searchString").get(authMiddleware([]), searchStudents); // Allow all authenticated users
router.route("/delete/:studentIds")
    .delete(canDelete, deleteStudents);
router.route("/:id").get(authMiddleware([]), getStudent) // Allow all authenticated users
    .put(authMiddleware(["superadmin", "admin", "moderator"]), updateStudent)
    .delete(canDelete, deleteStudent);

export default router;