import mongoose, { Schema, Types } from "mongoose";

export interface IUserSettingsInput {
    userId: Types.ObjectId;
    developingStudentCollumns?: string[];
    studentCollumns: string[];
    allStudentCollumns: string[];
    allTeacherCollumns: string[];
    allSchoolCollumns: string[];
    allDistrictCollumns: string[];
}

export interface IUserSettings extends Document {
    userId: Types.ObjectId;
    developingStudentCollumns?: string[];
    studentCollumns: string[];
    allStudentCollumns: string[];
    allTeacherCollumns: string[];
    allSchoolCollumns: string[];
    allDistrictCollumns: string[];
}

const UserSettingsSchema: Schema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    developingStudentCollumns: { type: [String], required: false },
    studentCollumns: { type: [String], required: true },
    allStudentCollumns: { type: [String], required: true },
    allTeacherCollumns: { type: [String], required: true },
    allSchoolCollumns: { type: [String], required: true },
    allDistrictCollumns: { type: [String], required: true }
}, {
    timestamps: true,
    versionKey: false
});

export default mongoose.model<IUserSettings>("UserSettings", UserSettingsSchema);