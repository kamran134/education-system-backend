/**
 * ONE-TIME migration script: moves flat score/averageScore/place fields
 * to the ratings[] array structure introduced in the ratings migration.
 *
 * Run via: POST /api/admin/migrate-ratings  (superAdmin only)
 * 
 * Safe to run multiple times — only migrates documents that have old flat fields
 * and do NOT already have a ratings entry for the current academic year.
 */
import District from "../models/district.model";
import School from "../models/school.model";
import Teacher from "../models/teacher.model";
import { getCurrentAcademicYear } from "./academic-year.util";

export interface MigrationResult {
    districts: { migrated: number; skipped: number };
    schools: { migrated: number; skipped: number };
    teachers: { migrated: number; skipped: number };
}

export async function migrateRatingsFromFlatFields(): Promise<MigrationResult> {
    const currentYear = getCurrentAcademicYear();

    const result: MigrationResult = {
        districts: { migrated: 0, skipped: 0 },
        schools: { migrated: 0, skipped: 0 },
        teachers: { migrated: 0, skipped: 0 },
    };

    // ---- DISTRICTS ----
    const districts = await District.find().lean() as any[];
    const districtOps: any[] = [];

    for (const d of districts) {
        const hasCurrentYearRating = (d.ratings || []).some((r: any) => r.year === currentYear);
        const hasOldFields = d.score !== undefined || d.averageScore !== undefined;

        if (!hasCurrentYearRating && hasOldFields) {
            districtOps.push({
                updateOne: {
                    filter: { _id: d._id },
                    update: [{
                        $set: {
                            ratings: {
                                $concatArrays: [
                                    { $ifNull: ["$ratings", []] },
                                    [{
                                        year: currentYear,
                                        score: d.score ?? 0,
                                        averageScore: d.averageScore ?? 0,
                                        place: d.place ?? null
                                    }]
                                ]
                            }
                        }
                    }]
                }
            });
            result.districts.migrated++;
        } else {
            result.districts.skipped++;
        }
    }

    if (districtOps.length > 0) {
        await District.bulkWrite(districtOps as any);
    }

    // ---- SCHOOLS ----
    const schools = await School.find().lean() as any[];
    const schoolOps: any[] = [];

    for (const s of schools) {
        const hasCurrentYearRating = (s.ratings || []).some((r: any) => r.year === currentYear);
        const hasOldFields = s.score !== undefined || s.averageScore !== undefined;

        if (!hasCurrentYearRating && hasOldFields) {
            schoolOps.push({
                updateOne: {
                    filter: { _id: s._id },
                    update: [{
                        $set: {
                            ratings: {
                                $concatArrays: [
                                    { $ifNull: ["$ratings", []] },
                                    [{
                                        year: currentYear,
                                        score: s.score ?? 0,
                                        averageScore: s.averageScore ?? 0,
                                        place: s.place ?? null
                                    }]
                                ]
                            }
                        }
                    }]
                }
            });
            result.schools.migrated++;
        } else {
            result.schools.skipped++;
        }
    }

    if (schoolOps.length > 0) {
        await School.bulkWrite(schoolOps as any);
    }

    // ---- TEACHERS ----
    const teachers = await Teacher.find().lean() as any[];
    const teacherOps: any[] = [];

    for (const t of teachers) {
        const hasCurrentYearRating = (t.ratings || []).some((r: any) => r.year === currentYear);
        const hasOldFields = t.score !== undefined || t.averageScore !== undefined;

        if (!hasCurrentYearRating && hasOldFields) {
            teacherOps.push({
                updateOne: {
                    filter: { _id: t._id },
                    update: [{
                        $set: {
                            ratings: {
                                $concatArrays: [
                                    { $ifNull: ["$ratings", []] },
                                    [{
                                        year: currentYear,
                                        score: t.score ?? 0,
                                        averageScore: t.averageScore ?? 0,
                                        place: t.place ?? null
                                    }]
                                ]
                            }
                        }
                    }]
                }
            });
            result.teachers.migrated++;
        } else {
            result.teachers.skipped++;
        }
    }

    if (teacherOps.length > 0) {
        await Teacher.bulkWrite(teacherOps as any);
    }

    console.log("✅ Ratings migration complete:", result);
    return result;
}
