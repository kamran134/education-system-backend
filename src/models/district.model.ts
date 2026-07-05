import mongoose, {Schema, Document} from "mongoose";
import { YearRating } from "../types/yearRating";


export interface IDistrictCreate {
    code: number;
    region?: string;
    name: string;
    studentCount?: number;
    rate?: number;
    districtOfTheYearScore?: number;
    active?: boolean;
    ratings?: YearRating[];
}


export interface IDistrict extends Document {
    code: number;
    region: string;
    name: string;
    studentCount: number;
    rate: number;
    districtOfTheYearScore: number;
    active: boolean;
    ratings: YearRating[];
    /** Current-year values projected from ratings[] at read time (no root schema fields) */
    score?: number;
    averageScore?: number;
    place?: number | null;
    filterPlace?: number | null;
}

const YearRatingSchema = new Schema({
    year: { type: Number, required: true },
    score: { type: Number, required: false, default: 0 },
    averageScore: { type: Number, required: false, default: 0 },
    place: { type: Number, required: false, default: null }
}, { _id: false });

const DistrictSchema: Schema = new Schema({
    code: { type: Number, required: true, unique: true },
    region: { type: String, required: false },
    name: { type: String, required: true },
    studentCount: { type: Number, required: false },
    rate: { type: Number, required: false },
    districtOfTheYearScore: { type: Number, required: false, default: 0 },
    active: { type: Boolean, required: false, default: true },
    ratings: { type: [YearRatingSchema], required: false, default: [] }
});

export default mongoose.model<IDistrict>("District", DistrictSchema);
