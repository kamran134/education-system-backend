import mongoose, { Schema, Document, Types } from "mongoose";
import { ISchool } from "./school.model";
import { IDistrict } from "./district.model";
import { YearRating } from "../types/yearRating";

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
    studentCount?: number;
    status?: string;
    teacherOfTheYearScore?: number;
    active?: boolean;
    ratings?: YearRating[];
    score?: number;
    averageScore?: number;
    place?: number | null;
    districtPlace?: number | null;
}


export interface ITeacher extends Document {
    code: number;
    district: IDistrict;
    school: ISchool;
    fullname: string;
    studentCount: number;
    status: string;
    teacherOfTheYearScore: number;
    active: boolean;
    ratings: YearRating[];
    /** Current-year denormalized fields — updated by updateTeacherScores + updateTeacherRankings */
    score: number;
    averageScore: number;
    place: number | null;
    districtPlace: number | null;
    filterPlace?: number | null;
    avatarUrl?: string;
}

const YearRatingSchema = new Schema({
    year: { type: Number, required: true },
    score: { type: Number, required: false, default: 0 },
    averageScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false, default: null },
    districtPlace: { type: Number, required: false, default: null }
}, { _id: false });

const TeacherSchema: Schema = new Schema({
    code: { type: Number, required: true, unique: true},
    district: { type: Types.ObjectId, ref: 'District' },
    school: { type: Types.ObjectId, ref: 'School' },
    fullname: { type: String, required: true },
    studentCount: { type: Number, required: false },
    status: { type: String, required: false },
    teacherOfTheYearScore: { type: Number, required: false, default: 0 },
    active: { type: Boolean, required: false, default: true },
    ratings: { type: [YearRatingSchema], required: false, default: [] },
    score: { type: Number, required: false, default: 0 },
    averageScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false, default: null },
    districtPlace: { type: Number, required: false, default: null },
    avatarUrl: { type: String, required: false }
});

export default mongoose.model<ITeacher>("Teacher", TeacherSchema);
