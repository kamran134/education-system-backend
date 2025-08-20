"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRole = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
var UserRole;
(function (UserRole) {
    UserRole["SUPERADMIN"] = "superadmin";
    UserRole["ADMIN"] = "admin";
    UserRole["MODERATOR"] = "moderator";
    UserRole["TEACHER"] = "teacher";
    UserRole["USER"] = "user";
})(UserRole || (exports.UserRole = UserRole = {}));
const UserSchema = new mongoose_1.default.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin", "moderator", "user"], default: "user" },
    isApproved: { type: Boolean, default: false }
});
exports.default = mongoose_1.default.model("User", UserSchema);
