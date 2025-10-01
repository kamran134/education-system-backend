import mongoose, {Schema, Document} from "mongoose";


export interface IDistrictCreate {
    code: number;
    region?: string;
    name: string;
    score?: number;
    averageScore?: number;
    studentCount?: number;
    rate?: number;
    districtOfTheYearScore?: number;
    active?: boolean;
}


export interface IDistrict extends Document {
    code: number;
    region: string;
    name: string;
    score: number;
    averageScore: number;
    studentCount: number;
    rate: number;
    districtOfTheYearScore: number;
    active: boolean;
}

const DistrictSchema: Schema = new Schema({
    code: { type: Number, required: true, unique: true },
    region: { type: String, required: false },
    name: { type: String, required: true },
    score: { type: Number, required: false },
    averageScore: { type: Number, required: false },
    studentCount: { type: Number, required: false },
    rate: { type: Number, required: false },
    districtOfTheYearScore: { type: Number, required: false, default: 0 },
    active: { type: Boolean, required: false, default: true }
});

export default mongoose.model<IDistrict>("District", DistrictSchema);