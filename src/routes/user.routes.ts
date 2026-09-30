import express from 'express';
import { createUser, deleteUser, getUsers, updateUser, changePassword, getActivityStats, getActivityUsers } from '../controllers/user.controller';
import { authMiddleware, checkAdminRole, canDelete } from '../middleware/auth.middleware';

const router = express.Router();

router.route("/")
    .get(checkAdminRole, getUsers)
    .post(checkAdminRole, createUser)
    .put(checkAdminRole, updateUser);
// Login/online statistics (admin + superadmin only). Must be declared before "/:id".
router.route("/activity-stats")
    .get(checkAdminRole, getActivityStats);
router.route("/activity-stats/users")
    .get(checkAdminRole, getActivityUsers);
router.route("/:id")
    .delete(canDelete, deleteUser);
router.route("/:id/password")
    .put(checkAdminRole, changePassword);

export default router;