import mongoose, { Document } from "mongoose";

export enum UserRole {
    SUPERADMIN = "superadmin",
    ADMIN = "admin",
    MODERATOR = "moderator",
    DISTRICT_REPRESENTER = "districtRepresenter",
    SCHOOL_DIRECTOR = "schoolDirector",
    TEACHER = "teacher",
    STUDENT = "student"
}

export interface IUserCreate {
    email: string;
    passwordHash: string;
    role?: UserRole;
    isApproved?: boolean;
    districtId?: string;
    schoolId?: string;
    teacherId?: string;
    studentId?: string;
}

export interface IUser extends Document {
    email: string;
    passwordHash: string;
    role: UserRole;
    isApproved: boolean;
    refreshTokens?: string[];  // Массив активных refresh токенов
    lastLoginAt?: Date;        // Последний вход для статистики
    districtId?: mongoose.Types.ObjectId;  // ID района (для districtRepresenter)
    schoolId?: mongoose.Types.ObjectId;    // ID школы (для schoolDirector)
    teacherId?: mongoose.Types.ObjectId;   // ID учителя (для teacher)
    studentId?: mongoose.Types.ObjectId;   // ID студента (для student)
}

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { 
        type: String, 
        enum: ["superadmin", "admin", "moderator", "districtRepresenter", "schoolDirector", "teacher", "student"], 
        default: "student" 
    },
    isApproved: { type: Boolean, default: false },
    refreshTokens: { type: [String], default: [] },  // Массив активных refresh токенов
    lastLoginAt: { type: Date },                      // Последний вход
    districtId: { type: mongoose.Schema.Types.ObjectId, ref: 'District', required: false },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: false },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: false },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: false }
}, { 
    timestamps: true  // Автоматически добавит createdAt и updatedAt
});

// Индекс для быстрого поиска по refresh токенам (используется при каждом /refresh)
UserSchema.index({ refreshTokens: 1 });

export default mongoose.model<IUser>("User", UserSchema);