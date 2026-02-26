import mongoose, { Schema, Document, Types } from "mongoose";
import { ITeacher } from "./teacher.model";
import { ISchool } from "./school.model";
import { IDistrict } from "./district.model";
import { IStudentResult } from "./studentResult.model";
import { YearRating } from "../types/yearRating";

const YearRatingSchema = new Schema(
    { year: Number, score: Number, averageScore: Number, place: { type: Number, default: null } },
    { _id: false }
);

export interface IStudentInput {
    code: number;
    lastName: string;
    firstName: string;
    middleName: string;
    grade: number;
    maxLevel?: number;
    teacher?: Types.ObjectId;
    school?: Types.ObjectId;
    district?: Types.ObjectId;
}

export interface IStudent extends Document {
    code: number;
    lastName: string;
    firstName: string;
    middleName: string;
    grade: number; // sinif
    teacher: ITeacher;
    school?: ISchool;
    district: IDistrict;
    score: number;
    averageScore: number;
    maxLevel: number;
    place?: number;
    status: string;
    avatarUrl?: string;
    participationCount?: number; // computed field: number of exams participated
    ratings?: YearRating[];
}

export interface IStudentMini extends Document {
    code: number;
    lastName: string;
    firstName: string;
    middleName: string;
    grade: number;
    teacher: Types.ObjectId;
    school: Types.ObjectId;
    district: Types.ObjectId;
    score: number;
    averageScore: number,
    participationScore: number,
    developmentScore: number,
    studentOfTheMonthScore: number,
    republicWideStudentOfTheMonthScore: number,
    place?: number;
    status: string;
    avatarUrl?: string;
    participationCount?: number; // computed field: number of exams participated
    results: IStudentResult[];
}

const StudentSchema: Schema = new Schema({
    code: { type: Number, required: true },
    lastName: { type: String },
    firstName: { type: String, required: true },
    middleName: { type: String },
    grade: { type: Number },
    teacher: { type: Schema.Types.ObjectId, ref: "Teacher" },
    school: { type: Schema.Types.ObjectId, ref: "School" },
    district: { type: Schema.Types.ObjectId, ref: "District" },
    maxLevel: { type: Number, required: false },
    status: { type: String, required: false },
    score: { type: Number, required: false },
    averageScore: { type: Number, required: false },
    participationScore: { type: Number, required: false },
    developmentScore: { type: Number, required: false },
    studentOfTheMonthScore: { type: Number, required: false },
    republicWideStudentOfTheMonthScore: { type: Number, required: false },
    place: { type: Number, required: false },
    avatarUrl: { type: String, required: false },
    ratings: { type: [YearRatingSchema], required: false, default: [] },
});

export default mongoose.model<IStudent>("Student", StudentSchema);