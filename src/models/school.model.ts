import mongoose, { Schema, Document, Types } from "mongoose";
import { IDistrict } from "./district.model";

export interface ISchoolInput {
    name: string;
    address: string;
    code: number;
    districtCode: number;
}

export interface ISchool extends Document {
    name: string;
    address: string;
    code: number;
    districtCode: number;
    district: IDistrict;
    score: number;
    averageScore: number;
    status: string;
}

const SchoolSchema: Schema = new Schema({
    name: { type: String, required: true },
    address: { type: String, required: false },
    code: { type: Number, required: true, unique: true },
    districtCode: { type: Number, required: true },
    district: { type: Types.ObjectId, ref: 'District' },
    score: { type: Number, required: false },
    averageScore: { type: Number, required: false },
    status: { type: String, required: false },
});

export default mongoose.model<ISchool>("School", SchoolSchema);