import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBookletDisciplines {
    az?: string[];
    math?: string[];
    lifeKnowledge?: string[];
    logic?: string[];
    english?: string[];
}

export interface IBookletInput {
    exam: Types.ObjectId | string;
    variant: string;
    grade: number;
    disciplines: IBookletDisciplines;
    district?: Types.ObjectId | string;
    name?: string;
}

export interface IBookletCreate {
    exam: Types.ObjectId | string;
    variant: string;
    grade: number;
    disciplines: IBookletDisciplines;
    district?: Types.ObjectId | string;
    name?: string;
}

export interface IBooklet extends Document {
    exam: Types.ObjectId;
    variant: string;
    grade: number;
    disciplines: IBookletDisciplines;
    district?: Types.ObjectId;
    name?: string;
}

const BookletDisciplinesSchema = new Schema(
    {
        az:            { type: [String], required: false },
        math:          { type: [String], required: false },
        lifeKnowledge: { type: [String], required: false },
        logic:         { type: [String], required: false },
        english:       { type: [String], required: false },
    },
    { _id: false }
);

const BookletSchema: Schema = new Schema({
    exam:        { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    variant:     { type: String, required: true },
    grade:       { type: Number, required: true },
    disciplines: { type: BookletDisciplinesSchema, required: true },
    district:    { type: Schema.Types.ObjectId, ref: "District", required: false },
    name:        { type: String, required: false },
});

export default mongoose.model<IBooklet>("Booklet", BookletSchema);