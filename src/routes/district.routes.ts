import express from "express";
import { createAllDistricts, createDistrict, deleteDistrict, getDistrictById, getDistricts, updateDistrict, updateDistrictsStats } from "../controllers/district.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(authMiddleware([]), getDistricts) // Allow all authenticated users
    .post(authMiddleware(["superadmin", "admin"]), createDistrict);
router.route("/search")
    .get(authMiddleware([]), getDistricts); // Allow all authenticated users
router.route("/addAll")
    .post(authMiddleware(["superadmin", "admin"]), createAllDistricts);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateDistrictsStats);
router.route("/:id")
    .get(authMiddleware([]), getDistrictById) // Allow all authenticated users
    .put(authMiddleware(["superadmin", "admin"]), updateDistrict)
    .delete(authMiddleware(["superadmin", "admin"]), deleteDistrict);

export default router;