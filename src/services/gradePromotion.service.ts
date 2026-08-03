import Student from "../models/student.model";
import GradePromotionLog from "../models/gradePromotionLog.model";
import { MAX_STUDENT_GRADE, isGradePromotionWindowOpen, getPromotionTargetAcademicYear } from "../utils/academic-year.util";

export interface GradeBucket {
    grade: number | null;
    count: number;
    targetGrade: number | null; // null = выпускной класс (или битая запись без grade) — не трогаем
}

export interface GradePromotionPreview {
    windowOpen: boolean;
    alreadyPromotedThisYear: boolean;
    targetAcademicYear: number;
    byGrade: GradeBucket[];
    promotableCount: number;
    ceilingCount: number;
}

export interface GradePromotionResult {
    academicYear: number;
    promotedCount: number;
    ceilingCount: number;
}

export class GradePromotionService {
    async preview(): Promise<GradePromotionPreview> {
        const targetAcademicYear = getPromotionTargetAcademicYear();

        const [alreadyPromoted, grouped] = await Promise.all([
            GradePromotionLog.findOne({ academicYear: targetAcademicYear, status: 'completed' }),
            Student.aggregate([
                { $group: { _id: '$grade', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ])
        ]);

        const byGrade: GradeBucket[] = grouped.map((g: any) => {
            const grade = (g._id ?? null) as number | null;
            const isCeiling = grade === null || grade >= MAX_STUDENT_GRADE;
            return {
                grade,
                count: g.count as number,
                targetGrade: isCeiling ? null : grade + 1
            };
        });

        const promotableCount = byGrade.filter(g => g.targetGrade !== null).reduce((sum, g) => sum + g.count, 0);
        const ceilingCount = byGrade.filter(g => g.targetGrade === null).reduce((sum, g) => sum + g.count, 0);

        return {
            windowOpen: isGradePromotionWindowOpen(),
            alreadyPromotedThisYear: !!alreadyPromoted,
            targetAcademicYear,
            byGrade,
            promotableCount,
            ceilingCount
        };
    }

    async execute(executedByUserId: string): Promise<GradePromotionResult> {
        if (!isGradePromotionWindowOpen()) {
            const err: any = new Error('Sinif yüksəltmə yalnız iyul-avqust aylarında mümkündür');
            err.status = 403;
            throw err;
        }

        const academicYear = getPromotionTargetAcademicYear();

        // Unique index на academicYear — единственная защита от повторного/параллельного
        // запуска (транзакций в БД нет, так что именно insert-race тут работает как lock).
        let log;
        try {
            log = await GradePromotionLog.create({
                academicYear,
                status: 'in_progress',
                executedBy: executedByUserId,
                executedAt: new Date()
            });
        } catch (error: any) {
            if (error.code === 11000) {
                const err: any = new Error(`${academicYear}/${academicYear + 1} tədris ili üçün siniflər artıq yüksəldilib`);
                err.status = 409;
                throw err;
            }
            throw error;
        }

        try {
            const promoteResult = await Student.updateMany(
                { grade: { $lt: MAX_STUDENT_GRADE } },
                { $inc: { grade: 1 } }
            );
            const ceilingCount = await Student.countDocuments({ grade: { $gte: MAX_STUDENT_GRADE } });

            log.status = 'completed';
            log.promotedCount = promoteResult.modifiedCount;
            log.ceilingCount = ceilingCount;
            log.completedAt = new Date();
            await log.save();

            return {
                academicYear,
                promotedCount: promoteResult.modifiedCount,
                ceilingCount
            };
        } catch (error) {
            // Не оставляем "битый" one-shot замок висеть навсегда — иначе повторный
            // запуск после сбоя невозможен. Частичное применение $inc по одному полю
            // на плоской коллекции — крайне маловероятный сценарий, но на всякий случай.
            await GradePromotionLog.deleteOne({ _id: log._id });
            throw error;
        }
    }
}
