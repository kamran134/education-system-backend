import { Model } from "mongoose";
import { getCurrentAcademicYear } from "./academic-year.util";

/**
 * Core dense-rank algorithm.
 * Input: scores sorted in DESCENDING order.
 * Returns a Map<score, place> where ties get the same place.
 * Example: [10, 10, 8] → { 10→1, 8→2 }  (dense, not [10→1, 8→3])
 */
function buildDenseRankMap(sortedScores: number[]): Map<number, number> {
    const map = new Map<number, number>();
    let currentPlace = 1;
    let previousScore: number | null = null;

    sortedScores.forEach((score, index) => {
        if (index === 0) {
            map.set(score, 1);
            previousScore = score;
        } else if (score < previousScore!) {
            currentPlace++;
            map.set(score, currentPlace);
            previousScore = score;
        } else {
            map.set(score, currentPlace);
        }
    });

    return map;
}

type Rankable = { averageScore?: number; score?: number; place?: number | null };

/**
 * Sorts items in-place by scoreField DESC, then assigns dense-rank places.
 * Used by StatsService for teacher/school/district statistic queries where
 * display order = score order.
 */
export function assignPlaces<T extends Rankable>(
    items: T[],
    scoreField: 'averageScore' | 'score' = 'averageScore'
): T[] {
    if (items.length === 0) return items;

    items.sort((a, b) => (b[scoreField] || 0) - (a[scoreField] || 0));

    const rankMap = buildDenseRankMap(items.map(item => item[scoreField] || 0));

    items.forEach(item => {
        item.place = rankMap.get(item[scoreField] || 0) ?? null;
    });

    return items;
}

/**
 * Builds a dense score→place Map from an unsorted list of score-bearing objects
 * WITHOUT changing the order of items.
 * Used in StudentService.getFilteredStudents where MongoDB controls sort order.
 */
export function buildScorePlaceMap(scores: Array<{ score?: number }>): Map<number, number> {
    const sortedScores = scores.map(s => s.score || 0).sort((a, b) => b - a);
    return buildDenseRankMap(sortedScores);
}

/**
 * Updates the `place` field inside ratings[currentYear] for all entities
 * of an EntityModel using dense ranking by averageScore.
 *
 * Replaces the near-identical updateDistrictPlaces / updateSchoolPlaces /
 * updateTeacherPlaces private methods. Also fixes a bug in school/teacher
 * where `currentPlace = i + 1` produced position-based ranking instead of
 * dense ranking (ties got different places).
 *
 * @param EntityModel  Mongoose model (District, School, Teacher)
 * @param entityLabel  Label for logging ('районов' | 'школ' | 'учителей')
 * @param activeFilter Optional filter for the find query (e.g. { active: true })
 */
export async function updateEntityPlaces(
    EntityModel: Model<any>,
    entityLabel: string,
    activeFilter: Record<string, any> = {}
): Promise<void> {
    try {
        const currentYear = getCurrentAcademicYear();
        const entities = await EntityModel.find(activeFilter).select('_id ratings code').lean();

        const entitiesWithAvg = (entities as any[]).map(e => ({
            _id: e._id,
            averageScore: ((e.ratings || []).find((r: any) => r.year === currentYear) as any)?.averageScore ?? 0,
            code: (e.code as number) ?? 0
        })).filter(e => e.averageScore > 0);

        if (entitiesWithAvg.length === 0) {
            console.log(`Нет ${entityLabel} с averageScore > 0 для установки места в рейтинге.`);
            return;
        }

        entitiesWithAvg.sort((a, b) => {
            if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
            return a.code - b.code;
        });

        const rankMap = buildDenseRankMap(entitiesWithAvg.map(e => e.averageScore));

        const bulkOperations = entitiesWithAvg.map(entity => ({
            updateOne: {
                filter: { _id: entity._id },
                update: [{
                    $set: {
                        ratings: {
                            $map: {
                                input: { $ifNull: ["$ratings", []] },
                                as: "r",
                                in: {
                                    $cond: {
                                        if: { $eq: ["$$r.year", currentYear] },
                                        then: { $mergeObjects: ["$$r", { place: rankMap.get(entity.averageScore) ?? null }] },
                                        else: "$$r"
                                    }
                                }
                            }
                        }
                    }
                }]
            }
        }));

        if (bulkOperations.length > 0) {
            await EntityModel.bulkWrite(bulkOperations);
            console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} ${entityLabel}`);
        }

    } catch (error) {
        console.error(`❌ Ошибка при обновлении места в рейтинге ${entityLabel}:`, error);
        throw error;
    }
}
