import mongoose, { Schema, Types } from "mongoose";

export interface IUserSettingsInput {
    userId: Types.ObjectId;
    developingStudentCollumns?: string[];
    studentCollumns: string[];
    allStudentCollumns: string[];
    allTeacherCollumns: string[];
    allSchoolCollumns: string[];
    allDistrictCollumns: string[];
    teacherViewCollumns?: string[];
    directorViewCollumns?: string[];
    districtViewCollumns?: string[];
    studentViewCollumns?: string[];
}

export interface IUserSettings extends Document {
    userId: Types.ObjectId;
    developingStudentCollumns?: string[];
    studentCollumns: string[];
    allStudentCollumns: string[];
    allTeacherCollumns: string[];
    allSchoolCollumns: string[];
    allDistrictCollumns: string[];
    teacherViewCollumns?: string[];
    directorViewCollumns?: string[];
    districtViewCollumns?: string[];
    studentViewCollumns?: string[];
}

const UserSettingsSchema: Schema = new Schema({
    userId: { type: Schema.Types.Mixed, required: true, unique: true },
    developingStudentCollumns: { type: [String], required: false },
    studentCollumns: { type: [String], required: false, default: [] },
    allStudentCollumns: { type: [String], required: false, default: [] },
    allTeacherCollumns: { type: [String], required: false, default: [] },
    allSchoolCollumns: { type: [String], required: false, default: [] },
    allDistrictCollumns: { type: [String], required: false, default: [] },
    teacherViewCollumns: { type: [String], required: false, default: [] },
    directorViewCollumns: { type: [String], required: false, default: [] },
    districtViewCollumns: { type: [String], required: false, default: [] },
    studentViewCollumns: { type: [String], required: false, default: [] }
}, {
    timestamps: true,
    versionKey: false
});

export default mongoose.model<IUserSettings>("UserSettings", UserSettingsSchema);