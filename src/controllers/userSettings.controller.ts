import { Request, Response } from "express";
import UserSettings, { IUserSettings } from "../models/userSettings.model";
import { ResponseHandler } from "../utils/response-handler.util";

const GLOBAL_SETTINGS_ID = 'global';

export const getUserSettings = async (req: Request, res: Response) => {
    try {
        const userId = req.query.userId;
        if (!userId) {
            res.status(400).json(ResponseHandler.badRequest("User ID is required"));
            return;
        }
        const settings = await UserSettings.findOne({ userId });
        res.json(ResponseHandler.success(settings));
    } catch (error) {
        console.error("Error fetching user settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to fetch user settings", error));
    }
}

export const updateUserSettings = async (req: Request, res: Response) => {
    try {
        const settingsData: Partial<IUserSettings> = req.body;

        const updatedSettings = await UserSettings.findOneAndUpdate(
            { userId: settingsData.userId },
            { $set: settingsData },
            { new: true, upsert: true }
        );
        if (!updatedSettings) {
            res.status(404).json(ResponseHandler.notFound("User settings not found"));
            return;
        }
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
        const settings = await UserSettings.findOne({ userId: GLOBAL_SETTINGS_ID });
        res.json(ResponseHandler.success(settings || {}));
    } catch (error) {
        console.error("Error fetching global settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to fetch global settings", error));
    }
}

/** Update global role-view column settings (admin/superadmin only) */
export const updateGlobalSettings = async (req: Request, res: Response) => {
    try {
        const { teacherViewCollumns, directorViewCollumns, districtViewCollumns } = req.body;
        const updatedSettings = await UserSettings.findOneAndUpdate(
            { userId: GLOBAL_SETTINGS_ID },
            { $set: { userId: GLOBAL_SETTINGS_ID, teacherViewCollumns, directorViewCollumns, districtViewCollumns } },
            { new: true, upsert: true }
        );
        res.json(ResponseHandler.success(
            { updatedSettings },
            "Rol sütunları uğurla yeniləndi"
        ));
    } catch (error) {
        console.error("Error updating global settings:", error);
        res.status(500).json(ResponseHandler.internalError("Failed to update global settings", error));
    }
}