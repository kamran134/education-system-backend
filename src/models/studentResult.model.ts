import mongoose, { Schema, Document, Types } from "mongoose";
import { IDiscipline } from "./discipline.model";
import { IStudent } from "./student.model";
import { IExam } from "./exam.model";

export interface IStudentResultInput {
    student: mongoose.Types.ObjectId;
    exam: mongoose.Types.ObjectId;
    grade: number;
    disciplines: IDiscipline;
    totalScore: number;
    level: string;
}

export interface IStudentResultFileInput {
    examId: mongoose.Types.ObjectId;
    studentCode: number;
    grade: number;
    lastName: string;
    firstName: string;
    middleName: string;
    az: number;
    math: number;
    lifeKnowledge: number;
    logic: number;
    totalScore: number;
    level: string;
}

export interface IStudentResult extends Document {
    student: IStudent;
    exam: IExam;
    grade: number;
    disciplines: {
        az: number;
        math: number;
        lifeKnowledge: number;
        logic: number;
    };
    totalScore: number;
    level: string;
    score?: number;
}

const StudentResultSchema: Schema = new Schema({
    student: { type: Types.ObjectId, ref: 'Student', required: true },
    exam: { type: Types.ObjectId, ref: 'Exam', required: true },
    grade: { type: Number, required: true },
    disciplines: {
        az: { type: Number, required: true },
        math: { type: Number, required: true },
        lifeKnowledge: { type: Number, required: true },
        logic: { type: Number, required: true },
    },
    totalScore: { type: Number, required: true },
    score: { type: Number, required: true },
    level: { type: String, required: true },
});

StudentResultSchema.index({ student: 1, exam: 1 }, { unique: true });

export default mongoose.model<IStudentResult>("StudentResult", StudentResultSchema);