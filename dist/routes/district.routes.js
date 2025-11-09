"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const district_controller_1 = require("../controllers/district.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.route("/")
    .get((0, auth_middleware_1.authMiddleware)([]), district_controller_1.getDistricts) // Allow all authenticated users
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.createDistrict);
router.route("/search")
    .get((0, auth_middleware_1.authMiddleware)([]), district_controller_1.getDistricts); // Allow all authenticated users
router.route("/addAll")
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.createAllDistricts);
router.route("/update-stats")
    .post((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.updateDistrictsStats);
router.route("/:id")
    .get((0, auth_middleware_1.authMiddleware)([]), district_controller_1.getDistrictById) // Allow all authenticated users
    .put((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.updateDistrict)
    .delete((0, auth_middleware_1.authMiddleware)(["superadmin", "admin"]), district_controller_1.deleteDistrict);
exports.default = router;
