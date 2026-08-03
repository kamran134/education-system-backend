import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Один документ на учебный год = защита от повторного/параллельного повышения классов.
 * Уникальный индекс на academicYear — единственный источник "one-shot" гарантии
 * (в БД нет транзакций, так что именно unique-insert ловит гонку двух кликов подряд).
 */
export interface IGradePromotionLog extends Document {
    academicYear: number; // год начала учебного года, В КОТОРЫЙ повышаются ученики
    status: 'in_progress' | 'completed';
    promotedCount?: number;
    ceilingCount?: number;
    executedBy: Types.ObjectId;
    executedAt: Date;
    completedAt?: Date;
}

const GradePromotionLogSchema: Schema = new Schema({
    academicYear: { type: Number, required: true, unique: true },
    status: { type: String, enum: ['in_progress', 'completed'], required: true, default: 'in_progress' },
    promotedCount: { type: Number, required: false },
    ceilingCount: { type: Number, required: false },
    executedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    executedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date, required: false }
});

export default mongoose.model<IGradePromotionLog>("GradePromotionLog", GradePromotionLogSchema);
