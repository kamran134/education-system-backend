"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserSettings = exports.getUserSettings = void 0;
const userSettings_model_1 = __importDefault(require("../models/userSettings.model"));
const response_handler_util_1 = require("../utils/response-handler.util");
const getUserSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.query.userId;
        if (!userId) {
            res.status(400).json(response_handler_util_1.ResponseHandler.badRequest("User ID is required"));
            return;
        }
        const settings = yield userSettings_model_1.default.findOne({ userId });
        res.json(response_handler_util_1.ResponseHandler.success(settings));
    }
    catch (error) {
        console.error("Error fetching user settings:", error);
        res.status(500).json(response_handler_util_1.ResponseHandler.internalError("Failed to fetch user settings", error));
    }
});
exports.getUserSettings = getUserSettings;
const updateUserSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const settingsData = req.body;
        const updatedSettings = yield userSettings_model_1.default.findOneAndUpdate({ userId: settingsData.userId }, { $set: settingsData }, { new: true, upsert: true });
        if (!updatedSettings) {
            res.status(404).json(response_handler_util_1.ResponseHandler.notFound("User settings not found"));
            return;
        }
        res.json(response_handler_util_1.ResponseHandler.success({ updatedSettings }, "Sütunlar uğurla yeniləndi"));
    }
    catch (error) {
        console.error("Error updating user settings:", error);
        res.status(500).json(response_handler_util_1.ResponseHandler.internalError("Failed to update user settings", error));
    }
});
exports.updateUserSettings = updateUserSettings;
