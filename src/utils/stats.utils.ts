import { Model, Types } from "mongoose";
import Student from "../models/student.model";
import { getCurrentAcademicYear } from "./academic-year.util";

/**
 * Общая логика обновления статистики для районов, школ и учителей.
 * Устраняет дублирование в DistrictService, SchoolService, TeacherService.
 *
 * @param EntityModel       Mongoose-модель сущности (District, School, Teacher)
 * @param studentField      Поле в модели Student ('district' | 'school' | 'teacher')
 * @param entityCollection  MongoDB-коллекция сущности ('districts' | 'schools' | 'teachers')
 * @param entityLabel       Название для логов ('районов' | 'школ' | 'учителей')
 * @param updatePlaces      Функция обновления мест в рейтинге (специфична для каждой сущности)
 */
export async function updateEntityStats(
    EntityModel: Model<any>,
    studentField: string,
    entityCollection: string,
    entityLabel: string,
    updatePlaces: () => Promise<void>
): Promise<void> {
    const currentYear = getCurrentAcademicYear();

    // 1. Обнуляем статистику всех сущностей за текущий год
    console.log(`🧹 Обнуляем статистику ${entityLabel}...`);
    await EntityModel.updateMany({}, [{
        $set: {
            ratings: {
                $concatArrays: [
                    { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                    [{ year: currentYear, score: 0, averageScore: 0, place: null }]
                ]
            }
        }
    }] as any);

    // 2. Группируем студентов по сущности в MongoDB (без загрузки всех записей в память)
    const stats: { _id: Types.ObjectId; sum: number; studentCount: number }[] = await Student.aggregate([
        { $match: { [studentField]: { $exists: true, $ne: null } } },
        { $group: {
            _id: `$${studentField}`,
            sum: { $sum: { $cond: [{ $isNumber: '$score' }, '$score', 0] } }
        }},
        { $lookup: {
            from: entityCollection,
            localField: '_id',
            foreignField: '_id',
            as: 'entityData'
        }},
        { $unwind: '$entityData' },
        { $project: { _id: 1, sum: 1, studentCount: { $ifNull: ['$entityData.studentCount', 0] } } }
    ]);

    // 3. Обновляем все сущности одним bulkWrite вместо N+1 запросов
    const bulkOps = stats.map(({ _id: entityId, sum, studentCount }) => {
        const average = studentCount > 0 ? sum / studentCount : 0;
        return {
            updateOne: {
                filter: { _id: entityId },
                update: [{
                    $set: {
                        ratings: {
                            $concatArrays: [
                                { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                                [{ year: currentYear, score: sum, averageScore: average, place: null }]
                            ]
                        }
                    }
                }] as any
            }
        };
    });
    if (bulkOps.length > 0) {
        await EntityModel.bulkWrite(bulkOps);
    }

    // 4. Обновляем места в рейтинге
    console.log(`🏆 Обновляем рейтинг ${entityLabel} (place)...`);
    await updatePlaces();
}
