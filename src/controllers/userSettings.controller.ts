import { Request, Response } from "express";
import { getUserSettingsPg, getGlobalSettingsPg, upsertUserSettingsPg, upsertGlobalSettingsPg } from "../services/userSettings.service.pg";
import { ResponseHandler } from "../utils/response-handler.util";

export const getUserSettings = async (req: Request, res: Response) => {
    try {
        // Own settings only: the id comes from the JWT. A `userId` in the query (still sent by the
        // frontend) is ignored, otherwise any user could read anyone's settings.
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }
        const settings = await getUserSettingsPg(parseInt(userId, 10));
        res.json(ResponseHandler.success(settings));
    } catch (error) {
        console.error("Error fetching user settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to fetch user settings", error));
    }
}

export const updateUserSettings = async (req: Request, res: Response) => {
    try {
        // Own settings only: `userId` in the body is dropped and the JWT's is used instead.
        const { userId: _ignoredUserId, ...settingsData } = req.body;
        const userId = req.user?.userId;
        if (!userId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }

        const updatedSettings = await upsertUserSettingsPg(parseInt(userId, 10), settingsData);
        res.json(ResponseHandler.success(
            { updatedSettings },
            "Sütunlar uğurla yeniləndi"
        ));
    } catch (error) {
        console.error("Error updating user settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to update user settings", error));
    }
}

/** Global role-view column settings (readable by all authenticated users) */
export const getGlobalSettings = async (req: Request, res: Response) => {
    try {
        const settings = await getGlobalSettingsPg();
        res.json(ResponseHandler.success(settings || {}));
    } catch (error) {
        console.error("Error fetching global settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to fetch global settings", error));
    }
}

/** Update global role-view column settings (admin/superadmin only) */
export const updateGlobalSettings = async (req: Request, res: Response) => {
    try {
        const { teacherViewCollumns, directorViewCollumns, districtViewCollumns, roleSettings } = req.body;
        const updatedSettings = await upsertGlobalSettingsPg({ teacherViewCollumns, directorViewCollumns, districtViewCollumns, roleSettings });
        res.json(ResponseHandler.success(
            { updatedSettings },
            "Rol sütunları uğurla yeniləndi"
        ));
    } catch (error) {
        console.error("Error updating global settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to update global settings", error));
    }
}
