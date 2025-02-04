import mongoose, { Schema, Document } from "mongoose";

export interface IStudentInput {
    code: number;
    lastName: string;
    firstName: string;
    middleName: string;
    grade: number;
    teacher?: mongoose.Types.ObjectId;
}

export interface IStudent extends Document {
    code: number;
    lastName: string;
    firstName: string;
    middleName: string;
    grade: number; // sinif
    teacher?: mongoose.Types.ObjectId;
}

const StudentSchema: Schema = new Schema({
    code: { type: Number, required: true },
    lastName: { type: String },
    firstName: { type: String, required: true },
    middleName: { type: String },
    grade: { type: Number },
    teacher: { type: Schema.Types.ObjectId, ref: "Teacher" }
});

export default mongoose.model<IStudent>("Student", StudentSchema);