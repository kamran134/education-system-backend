import mongoose, { Document } from "mongoose";

export enum UserRole {
    SUPERADMIN = "superadmin",
    ADMIN = "admin",
    MODERATOR = "moderator",
    TEACHER = "teacher",
    USER = "user"
}

export interface IUserCreate {
    email: string;
    passwordHash: string;
    role?: UserRole;
    isApproved?: boolean;
}

export interface IUser extends Document {
    email: string;
    passwordHash: string;
    role: UserRole;
    isApproved: boolean;
}

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin", "moderator", "teacher", "user"], default: "user" },
    isApproved: { type: Boolean, default: false }
});

export default mongoose.model<IUser>("User", UserSchema);