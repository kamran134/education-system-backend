import mongoose, { Schema, Document, Types } from "mongoose";
import { IDistrict } from "./district.model";
import { YearRating } from "../types/yearRating";

export interface ISchoolInput {
    name: string;
    address: string;
    code: number;
    districtCode: number;
}


export interface ISchoolCreate {
    name: string;
    address?: string;
    code: number;
    districtCode: number;
    district: Types.ObjectId;
    studentCount?: number;
    status?: string;
    schoolOfTheYearScore?: number;
    active?: boolean;
    ratings?: YearRating[];
    score?: number;
    averageScore?: number;
    place?: number | null;
    districtPlace?: number | null;
}


export interface ISchool extends Document {
    name: string;
    address: string;
    code: number;
    districtCode: number;
    district: IDistrict;
    studentCount: number;
    status: string;
    schoolOfTheYearScore: number;
    active: boolean;
    ratings: YearRating[];
    /** Current-year denormalized fields — updated by updateSchoolScores + updateSchoolRankings */
    score: number;
    averageScore: number;
    place: number | null;
    districtPlace: number | null;
}

const YearRatingSchema = new Schema({
    year: { type: Number, required: true },
    score: { type: Number, required: false, default: 0 },
    averageScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false, default: null },
    districtPlace: { type: Number, required: false, default: null }
}, { _id: false });

const SchoolSchema: Schema = new Schema({
    name: { type: String, required: true },
    address: { type: String, required: false },
    code: { type: Number, required: true, unique: true },
    districtCode: { type: Number, required: true },
    district: { type: Types.ObjectId, ref: 'District', required: true },
    studentCount: { type: Number, required: false },
    status: { type: String, required: false },
    schoolOfTheYearScore: { type: Number, required: false, default: 0 },
    active: { type: Boolean, required: false, default: true },
    ratings: { type: [YearRatingSchema], required: false, default: [] },
    score: { type: Number, required: false, default: 0 },
    averageScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false, default: null },
    districtPlace: { type: Number, required: false, default: null }
});

export default mongoose.model<ISchool>("School", SchoolSchema);
