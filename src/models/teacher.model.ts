import mongoose, { Schema, Document, Types } from "mongoose";
import { ISchool } from "./school.model";
import { IDistrict } from "./district.model";

export interface ITeacherInput {
    districtCode: number;
    schoolCode: number;
    code: number;
    fullname: string;
}

export interface ITeacher extends Document {
    code: number;
    district: IDistrict;
    school: ISchool;
    fullname: string;
    score: number;
    averageScore: number;
    status: string;
    active: boolean;
}

const TeacherSchema: Schema = new Schema({
    code: { type: Number, required: true, unique: true},
    district: { type: Types.ObjectId, ref: 'District' },
    school: { type: Types.ObjectId, ref: 'School' },
    fullname: { type: String, required: true },
    score: { type: Number, required: false },
    averageScore: { type: Number, required: false },
    status: { type: String, required: false },
    active: { type: Boolean, required: false, default: true },
});

export default mongoose.model<ITeacher>("Teacher", TeacherSchema);