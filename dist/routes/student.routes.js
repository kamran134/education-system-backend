"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const student_controller_1 = require("../controllers/student.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.route("/")
    .get((0, auth_middleware_1.authMiddleware)([]), student_controller_1.getStudents) // Allow all authenticated users
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), student_controller_1.createStudent)
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), student_controller_1.deleteAllStudents);
router.route("/repair")
    .get((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), student_controller_1.repairStudents);
// router.route("/forStats")
//     .get(getStudentsForStats);
router.route("/search/:searchString").get((0, auth_middleware_1.authMiddleware)([]), student_controller_1.searchStudents); // Allow all authenticated users
router.route("/delete/:studentIds")
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), student_controller_1.deleteStudents);
router.route("/:id").get((0, auth_middleware_1.authMiddleware)([]), student_controller_1.getStudent) // Allow all authenticated users
    .put((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), student_controller_1.updateStudent)
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), student_controller_1.deleteStudent);
exports.default = router;
