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
const getUserSettings = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const settings = yield userSettings_model_1.default.findOne({ userId });
        return settings;
    }
    catch (error) {
        console.error("Error fetching user settings:", error);
        throw new Error("Failed to fetch user settings");
    }
});
exports.getUserSettings = getUserSettings;
const updateUserSettings = (userId, settingsData) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const updatedSettings = yield userSettings_model_1.default.findOneAndUpdate({ userId }, { $set: settingsData }, { new: true, upsert: true });
        return updatedSettings;
    }
    catch (error) {
        console.error("Error updating user settings:", error);
        throw new Error("Failed to update user settings");
    }
});
exports.updateUserSettings = updateUserSettings;
