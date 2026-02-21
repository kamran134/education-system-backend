import { Request } from "express";
import Teacher, { ITeacher, ITeacherCreate } from "../models/teacher.model";
import Student from "../models/student.model";
import School from "../models/school.model";
import District from "../models/district.model";
import { Types } from "mongoose";
import { deleteStudentsByTeacherId, deleteStudentsByTeachersIds } from "./student.service";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

export class TeacherService {
    /**
     * Обновляет статистику по учителям: studentCount, score, averageScore
     */
    async updateTeachersStats(): Promise<void> {
        const currentYear = getCurrentAcademicYear();
        // Сначала обнуляем статистику всех учителей
        console.log("🧹 Обнуляем статистику учителей...");
        await Teacher.updateMany({}, [{
            $set: {
                ratings: {
                    $concatArrays: [
                        { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                        [{ year: currentYear, score: 0, averageScore: 0, place: null }]
                    ]
                }
            }
        }] as any);
        
        // Получаем всех студентов с teacher и score
        const students = await Student.find({}, { teacher: 1, score: 1 }).populate('teacher', 'studentCount');
        
        // Группируем по teacher
        const statsMap = new Map<string, { sum: number, studentCount: number }>();
        for (const student of students) {
            const teacherId = student.teacher?._id?.toString();
            if (!teacherId) continue;
            const score = typeof student.score === 'number' ? student.score : 0;
            if (!statsMap.has(teacherId)) {
                statsMap.set(teacherId, { sum: 0, studentCount: student.teacher?.studentCount || 0 });
            }
            const stat = statsMap.get(teacherId)!;
            stat.sum += score;
        }
        // Обновляем каждого учителя
        for (const [teacherId, { sum, studentCount }] of statsMap.entries()) {
            const average = sum > 0 ? sum / studentCount : 0;
            await Teacher.findByIdAndUpdate(teacherId, [{
                $set: {
                    ratings: {
                        $concatArrays: [
                            { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                            [{ year: currentYear, score: sum, averageScore: average, place: null }]
                        ]
                    }
                }
            }] as any);
        }

        // Обновляем место в рейтинге (place) для всех учителей
        console.log("🏆 Обновляем рейтинг учителей (place)...");
        await this.updateTeacherPlaces();
    }

    /**
     * Обновляет место в рейтинге (place) для всех учителей на основе их averageScore
     */
    private async updateTeacherPlaces(): Promise<void> {
        try {
            const currentYear = getCurrentAcademicYear();
            const teachers = await Teacher.find({ active: true }).select('_id ratings code').lean();

            const teachersWithAvg = teachers.map((t: any) => ({
                _id: t._id,
                averageScore: ((t.ratings || []).find((r: any) => r.year === currentYear) as any)?.averageScore ?? 0,
                code: t.code
            })).filter(t => t.averageScore > 0);

            if (teachersWithAvg.length === 0) {
                console.log("Нет учителей с averageScore > 0 для установки места в рейтинге.");
                return;
            }

            teachersWithAvg.sort((a, b) => {
                if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
                return (a.code ?? 0) - (b.code ?? 0);
            });

            const bulkOperations: any[] = [];
            let currentPlace = 1;
            let previousScore: number | null = null;

            for (let i = 0; i < teachersWithAvg.length; i++) {
                const teacher = teachersWithAvg[i];
                if (i > 0 && previousScore !== null && teacher.averageScore < previousScore) {
                    currentPlace = i + 1;
                }
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: teacher._id },
                        update: [{
                            $set: {
                                ratings: {
                                    $map: {
                                        input: { $ifNull: ["$ratings", []] },
                                        as: "r",
                                        in: {
                                            $cond: {
                                                if: { $eq: ["$$r.year", currentYear] },
                                                then: { $mergeObjects: ["$$r", { place: currentPlace }] },
                                                else: "$$r"
                                            }
                                        }
                                    }
                                }
                            }
                        }]
                    }
                });
                previousScore = teacher.averageScore;
            }

            if (bulkOperations.length > 0) {
                await Teacher.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} учителей`);
                const top = teachersWithAvg[0];
                const last = teachersWithAvg[teachersWithAvg.length - 1];
                console.log(`🥇 Лидер рейтинга учителей: ${top.averageScore} баллов (место 1)`);
                console.log(`📊 Всего в рейтинге: ${teachersWithAvg.length} учителей`);
                console.log(`🔢 Диапазон баллов: ${last.averageScore} - ${top.averageScore}`);
            }

        } catch (error) {
            console.error("❌ Ошибка при обновлении места в рейтинге учителей:", error);
            throw error;
        }
    }
    async findById(id: string): Promise<ITeacher | null> {
        return await Teacher.findById(id).populate('district school');
    }

    async findByCode(code: number): Promise<ITeacher | null> {
        return await Teacher.findOne({ code });
    }

    async create(teacherData: ITeacherCreate): Promise<ITeacher> {
        const teacher = new Teacher(teacherData);
        return await teacher.save();
    }

    async update(id: string, updateData: Partial<ITeacherCreate>): Promise<ITeacher> {
        const updatedTeacher = await Teacher.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('district school');

        if (!updatedTeacher) {
            throw new Error('Teacher not found');
        }

        return updatedTeacher;
    }

    async delete(id: string): Promise<void> {
        // First delete associated students
        await deleteStudentsByTeacherId(id);
        
        const result = await Teacher.findByIdAndDelete(id);
        if (!result) {
            throw new Error('Teacher not found');
        }
    }

    async deleteBulk(ids: Types.ObjectId[]): Promise<BulkOperationResult> {
        // First delete associated students
        await deleteStudentsByTeachersIds(ids.map(id => id.toString()));
        
        const result = await Teacher.deleteMany({ _id: { $in: ids } });
        return {
            insertedCount: 0,
            modifiedCount: 0,
            deletedCount: result.deletedCount || 0,
            errors: []
        };
    }

    async repairTeacherAssignments(): Promise<{ 
        repairedTeachers: number[], 
        failedTeachers: Array<{ code: number, reason: string }>,
        missedDistricts: number[],
        missedSchools: number[]
    }> {
        // Find teachers with missing school or district
        const teachers = await Teacher.find({
            $or: [
                { school: { $exists: false } },
                { school: null },
                { district: { $exists: false } },
                { district: null }
            ]
        });

        console.log(`Found ${teachers.length} teachers with missing assignments`);

        const repairedTeachers: number[] = [];
        const failedTeachers: Array<{ code: number, reason: string }> = [];
        const missedDistricts: number[] = [];
        const missedSchools: number[] = [];

        // Pre-fetch all schools and districts
        const allSchools = await School.find({});
        const allDistricts = await District.find({});

        // Create maps for quick lookup by CODE
        const schoolMap = new Map(allSchools.map(s => [s.code, s]));
        const districtMap = new Map(allDistricts.map(d => [d.code, d]));

        for (const teacher of teachers) {
            try {
                const teacherCode = teacher.code;
                let hasChanges = false;
                
                // Extract codes from teacher code (7 digits)
                // Example: 1500188 -> school=15001 (first 5 digits), district=150 (first 3 digits)
                const schoolCode = Math.floor(teacherCode / 100); // 15001
                const districtCode = Math.floor(teacherCode / 10000); // 150

                console.log(`Processing teacher ${teacherCode}: school=${schoolCode}, district=${districtCode}`);

                // Assign school if missing
                if (!(teacher as any).school) {
                    const school = schoolMap.get(schoolCode);
                    if (school) {
                        (teacher as any).school = school._id;
                        hasChanges = true;
                        console.log(`  ✓ Assigned school ${schoolCode}`);
                    } else {
                        console.log(`  ✗ School ${schoolCode} not found`);
                        missedSchools.push(teacherCode);
                    }
                }

                // Assign district if missing
                if (!(teacher as any).district) {
                    const district = districtMap.get(districtCode);
                    if (district) {
                        (teacher as any).district = district._id;
                        hasChanges = true;
                        console.log(`  ✓ Assigned district ${districtCode}`);
                    } else {
                        console.log(`  ✗ District ${districtCode} not found`);
                        missedDistricts.push(teacherCode);
                    }
                }

                // Save if there were changes
                if (hasChanges) {
                    await teacher.save();
                    repairedTeachers.push(teacherCode);
                    console.log(`✓ Saved teacher ${teacherCode}`);
                }

            } catch (error) {
                console.error(`Error processing teacher ${teacher.code}:`, error);
                failedTeachers.push({ 
                    code: teacher.code, 
                    reason: `Error: ${error instanceof Error ? error.message : 'Unknown'}` 
                });
            }
        }

        console.log(`Repair complete: ${repairedTeachers.length} repaired`);
        console.log(`  Missed schools: ${missedSchools.length}`);
        console.log(`  Missed districts: ${missedDistricts.length}`);
        
        return { 
            repairedTeachers, 
            failedTeachers,
            missedDistricts,
            missedSchools
        };
    }

    async getFilteredTeachers(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: ITeacher[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            Teacher.find(filter)
                .collation({ locale: 'az', strength: 2 })
                .populate('district school')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            Teacher.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    async getTeachersForFilter(filters: FilterOptions): Promise<ITeacher[]> {
        const filter = this.buildFilter(filters);
        
        return await Teacher.find(filter)
            .populate('school')
            .sort({ fullname: 1 });
    }

    async processTeachersFromExcel(filePath: string): Promise<FileProcessingResult<ITeacher>> {
        const processedData: ITeacher[] = [];
        const errors: string[] = [];
        const skippedItems: any[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 5) {
                throw new Error('Faylda kifayət qədər sətr yoxdur!');
            }

            const rows = data.slice(4); // Skip header rows (first 4 rows)
            const dataToInsert = rows.map(row => ({
                districtCode: Number(row[1]) || 0,
                schoolCode: Number(row[2]) || 0,
                code: Number(row[3]),
                fullname: String(row[4])
            }));

            // Filter correct teachers (teacher code must be 7 digits)
            const correctTeachersToInsert = dataToInsert.filter(data => data.code > 999999);
            const incorrectTeacherCodes = dataToInsert
                .filter(data => data.code <= 999999)
                .map(data => data.code);

            // Check existing teachers
            const existingTeacherCodes = await this.checkExistingTeacherCodes(
                correctTeachersToInsert.map(data => data.code)
            );
            
            const newTeachers = existingTeacherCodes.length > 0
                ? correctTeachersToInsert.filter(data => !existingTeacherCodes.includes(data.code))
                : correctTeachersToInsert;

            // Separate teachers without school codes
            const districtCodes = newTeachers.filter(item => item.districtCode > 0).map(item => item.districtCode);
            const schoolCodes = newTeachers.filter(item => item.schoolCode > 0).map(item => item.schoolCode);
            const teacherCodesWithoutSchoolCodes = newTeachers
                .filter(item => item.schoolCode === 0)
                .map(item => item.code);

            // Check which districts and schools exist
            const existingDistricts = await District.find({ code: { $in: districtCodes } });
            const existingSchools = await School.find({ code: { $in: schoolCodes } });

            const existingDistrictCodes = existingDistricts.map(d => d.code);
            const existingSchoolCodes = existingSchools.map(s => s.code);
            
            const missingSchoolCodes = schoolCodes.filter(code => !existingSchoolCodes.includes(code));
            const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code));

            const schoolMap = new Map(existingSchools.map(s => [s.code, s._id as Types.ObjectId]));
            const districtMap = new Map(existingDistricts.map(d => [d.code, d._id as Types.ObjectId]));

            // Filter teachers to save (only those with valid district and school)
            const teachersToSave = newTeachers.filter(
                item =>
                    item.code > 0 &&
                    !missingDistrictCodes.includes(item.districtCode) &&
                    !missingSchoolCodes.includes(item.schoolCode) &&
                    !teacherCodesWithoutSchoolCodes.includes(item.code)
            ).map(item => ({
                district: districtMap.get(item.districtCode),
                school: schoolMap.get(item.schoolCode),
                code: item.code,
                fullname: item.fullname,
                active: true
            }));

            // Save teachers using bulkWrite with upsert
            if (teachersToSave.length > 0) {
                const results = await Teacher.collection.bulkWrite(
                    teachersToSave.map(teacher => ({
                        updateOne: {
                            filter: { code: teacher.code },
                            update: { $set: teacher },
                            upsert: true
                        }
                    }))
                );

                // Fetch created/updated teachers for response
                const createdCodes = teachersToSave.map(t => t.code);
                const savedTeachers = await Teacher.find({ code: { $in: createdCodes } });
                processedData.push(...savedTeachers.map(t => t.toObject() as ITeacher));
            }

            // Clean up
            deleteFile(filePath);

            return {
                processedData,
                errors,
                skippedItems,
                validationErrors: {
                    incorrectTeacherCodes,
                    missingSchoolCodes: [...new Set(missingSchoolCodes)],
                    teacherCodesWithoutSchoolCodes,
                    existingTeacherCodes
                }
            };
        } catch (error) {
            deleteFile(filePath);
            throw error;
        }
    }

    async checkExistingTeacherCodes(codes: number[]): Promise<number[]> {
        const existingCodes = await Teacher.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {}; // Показываем всех учителей

        if (filters.districtIds && filters.districtIds.length > 0 && (!filters.schoolIds || filters.schoolIds.length === 0)) {
            filter.district = { $in: filters.districtIds };
        }

        if (filters.schoolIds && filters.schoolIds.length > 0) {
            filter.school = { $in: filters.schoolIds };
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 7);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        if (filters.search) {
            // Search by teacher fullname (case-insensitive)
            filter.fullname = { $regex: filters.search, $options: 'i' };
        }

        if (filters.active !== undefined) {
            filter.active = filters.active;
        }

        return filter;
    }

    async importLegacyTeachers(records: any[]): Promise<{
        inserted: number;
        skipped: number;
        errors: number;
        details: { skippedCodes: number[]; errorMessages: string[] };
    }> {
        const LEGACY_YEAR = 2024;
        let inserted = 0;
        let skipped = 0;
        let errors = 0;
        const skippedCodes: number[] = [];
        const errorMessages: string[] = [];

        for (const record of records) {
            try {
                const code = Number(record.code);
                if (!code || isNaN(code)) {
                    errors++;
                    errorMessages.push(`Record skipped: missing or invalid code (${JSON.stringify(record.code)})`);
                    continue;
                }

                // Skip if teacher already exists
                const existing = await Teacher.findOne({ code });
                if (existing) {
                    skipped++;
                    skippedCodes.push(code);
                    continue;
                }

                // Resolve school by school code (first 5 digits)
                const schoolCode = Math.floor(code / 100);
                const districtCode = Math.floor(code / 10000);

                let schoolId: Types.ObjectId | null = null;
                let districtId: Types.ObjectId | null = null;

                if (schoolCode) {
                    const schoolDoc = await School.findOne({ code: schoolCode });
                    if (schoolDoc) {
                        schoolId = schoolDoc._id as Types.ObjectId;
                    }
                }

                if (districtCode) {
                    const districtDoc = await District.findOne({ code: districtCode });
                    if (districtDoc) {
                        districtId = districtDoc._id as Types.ObjectId;
                    }
                }

                const score = typeof record.score === 'number' ? record.score : 0;
                const averageScore = typeof record.averageScore === 'number' ? record.averageScore : 0;

                const teacherData: any = {
                    code,
                    fullname: record.fullname || '',
                    school: schoolId,
                    district: districtId,
                    active: record.active !== undefined ? Boolean(record.active) : true,
                    ratings: [{ year: LEGACY_YEAR, score, averageScore, place: null }],
                };

                await Teacher.create(teacherData);
                inserted++;
            } catch (err: any) {
                errors++;
                errorMessages.push(`Teacher code ${record.code}: ${err.message}`);
            }
        }

        return { inserted, skipped, errors, details: { skippedCodes, errorMessages } };
    }
}

// Legacy functions for backward compatibility
const teacherService = new TeacherService();

export const checkExistingTeachers = async (codes: number[]): Promise<ITeacher[]> => {
    try {
        const result = await Teacher.find({ code: { $in: codes } });
        return result;
    } catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск!");
    }
}

export const checkExistingTeacherCodes = async (codes: number[]): Promise<number[]> => {
    return await teacherService.checkExistingTeacherCodes(codes);
}

export const getFiltredTeachers = async (req: Request): Promise<{ data: ITeacher[], totalCount: number }> => {
    const pagination = RequestParser.parsePagination(req);
    const filters = RequestParser.parseFilterOptions(req);
    const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

    return await teacherService.getFilteredTeachers(pagination, filters, sort);
}

export const deleteTeacherById = async (id: string): Promise<void> => {
    return await teacherService.delete(id);
}

export const deleteTeachersByIds = async (ids: string[]): Promise<BulkOperationResult> => {
    const objectIds = ids.map(id => new Types.ObjectId(id));
    return await teacherService.deleteBulk(objectIds);
}
