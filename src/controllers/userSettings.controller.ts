import { Request, Response } from "express";
import UserSettings, { IUserSettings } from "../models/userSettings.model";
import { ResponseHandler } from "../utils/response-handler.util";

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