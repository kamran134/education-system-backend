import mongoose, { Schema, Document } from "mongoose";

export interface IExamInput {
    name: string;
    code: number;
    date: Date;
}

export interface IExamCreate {
    name: string;
    code: number;
    date: Date;
    active?: boolean;
}

export interface IExam extends Document {
    name: string;
    code: number;
    date: Date;
    active: boolean;
}

const ExamSchema: Schema = new Schema({
    name: { type: String, required: true },
    code: { type: Number, required: true, unique: true },
    date: { type: Date, required: true },
    active: { type: Boolean, required: false, default: true }
});

export default mongoose.model<IExam>("Exam", ExamSchema);