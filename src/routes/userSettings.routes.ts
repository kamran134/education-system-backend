import express from 'express';
import { allRegisteredRoles, authMiddleware } from '../middleware/auth.middleware';
import { getUserSettings, updateUserSettings } from '../controllers/userSettings.controller';

const router = express.Router();

router.route('/')
    .get(allRegisteredRoles, getUserSettings)
    .put(allRegisteredRoles, updateUserSettings);

export default router;