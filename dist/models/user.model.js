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
    UserRole["DISTRICT_REPRESENTER"] = "districtRepresenter";
    UserRole["SCHOOL_DIRECTOR"] = "schoolDirector";
    UserRole["TEACHER"] = "teacher";
    UserRole["STUDENT"] = "student";
})(UserRole || (exports.UserRole = UserRole = {}));
const UserSchema = new mongoose_1.default.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: {
        type: String,
        enum: ["superadmin", "admin", "moderator", "districtRepresenter", "schoolDirector", "teacher", "student"],
        default: "student"
    },
    isApproved: { type: Boolean, default: false },
    refreshTokens: { type: [String], default: [] }, // Массив активных refresh токенов
    lastLoginAt: { type: Date }, // Последний вход
    districtId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'District', required: false },
    schoolId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'School', required: false },
    teacherId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Teacher', required: false },
    studentId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Student', required: false }
}, {
    timestamps: true // Автоматически добавит createdAt и updatedAt
});
exports.default = mongoose_1.default.model("User", UserSchema);
