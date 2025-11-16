import express from 'express';
import { createUser, deleteUser, getUsers, updateUser } from '../controllers/user.controller';
import { authMiddleware, checkAdminRole, canDelete } from '../middleware/auth.middleware';

const router = express.Router();

router.route("/")
    .get(checkAdminRole, getUsers)
    .post(checkAdminRole, createUser)
    .put(checkAdminRole, updateUser);
router.route("/:id")
    .delete(canDelete, deleteUser);

export default router;