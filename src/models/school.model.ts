import mongoose, { Schema, Document, Types } from "mongoose";
import { IDistrict } from "./district.model";

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
    districtCode?: number;
    district: Types.ObjectId;
    score?: number;
    averageScore?: number;
    studentCount?: number;
    status?: string;
    schoolOfTheYearScore?: number;
    place?: number;
    active?: boolean;
}


export interface ISchool extends Document {
    name: string;
    address: string;
    code: number;
    districtCode: number;
    district: IDistrict;
    score: number;
    averageScore: number;
    studentCount: number;
    status: string;
    schoolOfTheYearScore: number;
    place: number;
    active: boolean;
}

const SchoolSchema: Schema = new Schema({
    name: { type: String, required: true },
    address: { type: String, required: false },
    code: { type: Number, required: true, unique: true },
    districtCode: { type: Number, required: true },
    district: { type: Types.ObjectId, ref: 'District' },
    score: { type: Number, required: false },
    averageScore: { type: Number, required: false },
    studentCount: { type: Number, required: false },
    status: { type: String, required: false },
    schoolOfTheYearScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false },
    active: { type: Boolean, required: false, default: true },
});

export default mongoose.model<ISchool>("School", SchoolSchema);