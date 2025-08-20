"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const school_controller_1 = require("../controllers/school.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ dest: "uploads/" });
router.route("/").get(school_controller_1.getSchools).post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.createSchool);
router.route("/filter").get(school_controller_1.getSchoolsForFilter);
router.route("/upload").post(upload.single("file"), (0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.createAllSchools);
router.route("/repair").get((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.repairSchools);
router.route("/delete/:schoolIds").delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.deleteSchools);
router.route("/:id")
    .put((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.updateSchool)
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), school_controller_1.deleteSchool);
exports.default = router;
