import mongoose from "mongoose";

export interface IUser extends Document {
    email: string;
    passwordHash: string;
    role: "superadmin" | "admin" | "moderator" | "user";
    isApproved: boolean;
}

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin", "moderator", "user"], default: "user" },
    isApproved: { type: Boolean, default: false }
});

export default mongoose.model<IUser>("User", UserSchema);