import express from "express";
import { createAllDistricts, createDistrict, deleteDistrict, getDistrictById, getDistricts, updateDistrict, updateDistrictsStats } from "../controllers/district.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = express.Router();

router.route("/")
    .get(getDistricts)
    .post(authMiddleware(["superadmin", "admin"]), createDistrict);
router.route("/search")
    .get(authMiddleware(["superadmin", "admin"]), getDistricts); // Uses same endpoint with search query
router.route("/addAll")
    .post(authMiddleware(["superadmin", "admin"]), createAllDistricts);
router.route("/update-stats")
    .post(authMiddleware(["superadmin", "admin"]), updateDistrictsStats);
router.route("/:id")
    .get(getDistrictById)
    .put(authMiddleware(["superadmin", "admin"]), updateDistrict)
    .delete(authMiddleware(["superadmin", "admin"]), deleteDistrict);

export default router;