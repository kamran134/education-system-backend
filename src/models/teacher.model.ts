import mongoose, { Schema, Document, Types } from "mongoose";
import { ISchool } from "./school.model";
import { IDistrict } from "./district.model";

export interface ITeacherInput {
    districtCode: number;
    schoolCode: number;
    code: number;
    fullname: string;
}


export interface ITeacherCreate {
    code: number;
    district?: Types.ObjectId;
    school?: Types.ObjectId;
    fullname: string;
    score?: number;
    averageScore?: number;
    studentCount?: number;
    status?: string;
    teacherOfTheYearScore?: number;
    place?: number;
    active?: boolean;
}


export interface ITeacher extends Document {
    code: number;
    district: IDistrict;
    school: ISchool;
    fullname: string;
    score: number;
    averageScore: number;
    studentCount: number;
    status: string;
    teacherOfTheYearScore: number;
    place: number;
    active: boolean;
}

const TeacherSchema: Schema = new Schema({
    code: { type: Number, required: true, unique: true},
    district: { type: Types.ObjectId, ref: 'District' },
    school: { type: Types.ObjectId, ref: 'School' },
    fullname: { type: String, required: true },
    score: { type: Number, required: false },
    averageScore: { type: Number, required: false },
    studentCount: { type: Number, required: false },
    status: { type: String, required: false },
    teacherOfTheYearScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false },
    active: { type: Boolean, required: false, default: true },
});

export default mongoose.model<ITeacher>("Teacher", TeacherSchema);