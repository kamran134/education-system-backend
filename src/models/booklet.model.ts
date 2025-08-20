import mongoose, { Schema, Document } from "mongoose";

export interface IBookletInput {
    name: string;
    date: Date;
}

export interface IBookletCreate {
    name: string;
    date: Date;
    active?: boolean;
}

export interface IBooklet extends Document {
    name: string;
    date: Date;
    active: boolean;
}

const BookletSchema: Schema = new Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true },
    active: { type: Boolean, required: false, default: true }
});

export default mongoose.model<IBooklet>("Booklet", BookletSchema);