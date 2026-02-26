import { DeleteResult, Types } from "mongoose";
import School, { ISchool, ISchoolInput, ISchoolCreate } from "../models/school.model";
import District from "../models/district.model";
import Teacher from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { Request } from "express";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { getCurrentAcademicYear } from "../utils/academic-year.util";

export class SchoolService {
    /**
     * Обновляет статистику по школам: studentCount, score, averageScore
     */
    async updateSchoolsStats(): Promise<void> {
        const currentYear = getCurrentAcademicYear();
        // Сначала обнуляем статистику всех школ
        console.log("🧹 Обнуляем статистику школ...");
        await School.updateMany({}, [{
            $set: {
                ratings: {
                    $concatArrays: [
                        { $filter: { input: { $ifNull: ["$ratings", []] }, as: "r", cond: { $ne: ["$$r.year", currentYear] } } },
                        [{ year: currentYear, score: 0, averageScore: 0, place: null }]
                    ]
                }
            }
        }] as any);
        
        // Получаем всех студентов с school и score
        const students = await Student.find({}, { school: 1, score: 1 }).populate('school', 'studentCount');
        // Группируем по school
        const statsMap = new Map<string, { sum: number, studentCount: number }>();
        for (const student of students) {
            const schoolId = student.school?._id?.toString();
            if (!schoolId) continue;
            const score = typeof student.score === 'number' ? student.score : 0;
            if (!statsMap.has(schoolId)) {
                statsMap.set(schoolId, { sum: 0, studentCount: student.school?.studentCount || 0 });
            }
            const stat = statsMap.get(schoolId)!;
            stat.sum += score;
        }
        // Обновляем каждую школу
        for (const [schoolId, { sum, studentCount }] of statsMap.entries()) {
            const average = studentCount > 0 ? sum / studentCount : 0;
            await School.findByIdAndUpdate(schoolId, [{
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

        // ЗАКОММЕНТИРОВАНО: Обновление studentCount из суммы учителей (количество студентов устанавливается только вручную или через Excel)
        // console.log("👥 Обновляем количество студентов школ из суммы учителей...");
        // await this.updateSchoolStudentCountFromTeachers();

        // Обновляем место в рейтинге (place) для всех школ
        console.log("🏆 Обновляем рейтинг школ (place)...");
        await this.updateSchoolPlaces();
    }

    /**
     * ЗАКОММЕНТИРОВАНО: Обновляет studentCount школ из суммы studentCount их учителей
     * (количество студентов устанавливается только вручную или через Excel)
     */
    /*
    private async updateSchoolStudentCountFromTeachers(): Promise<void> {
        try {
            // Получаем агрегацию по школам с суммой studentCount учителей
            const schoolStats = await Teacher.aggregate([
                { $match: { school: { $exists: true, $ne: null }, active: true } },
                { 
                    $group: {
                        _id: "$school",
                        totalStudentCount: { $sum: "$studentCount" }
                    }
                }
            ]);

            // Подготавливаем bulk операции для обновления
            const bulkOperations = schoolStats.map(stat => ({
                updateOne: {
                    filter: { _id: stat._id },
                    update: { $set: { studentCount: stat.totalStudentCount } }
                }
            }));

            if (bulkOperations.length > 0) {
                await School.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено studentCount для ${bulkOperations.length} школ`);
            }
        } catch (error) {
            console.error("❌ Ошибка при обновлении studentCount школ:", error);
        }
    }
    */

    /**
     * Обновляет место в рейтинге (place) для всех школ на основе их averageScore
     */
    private async updateSchoolPlaces(): Promise<void> {
        try {
            const currentYear = getCurrentAcademicYear();
            const schools = await School.find({ active: true }).select('_id ratings code').lean();

            const schoolsWithAvg = schools.map((s: any) => ({
                _id: s._id,
                averageScore: ((s.ratings || []).find((r: any) => r.year === currentYear) as any)?.averageScore ?? 0,
                code: s.code
            })).filter(s => s.averageScore > 0);

            if (schoolsWithAvg.length === 0) {
                console.log("Нет школ с averageScore > 0 для установки места в рейтинге.");
                return;
            }

            schoolsWithAvg.sort((a, b) => {
                if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
                return (a.code ?? 0) - (b.code ?? 0);
            });

            const bulkOperations: any[] = [];
            let currentPlace = 1;
            let previousScore: number | null = null;

            for (let i = 0; i < schoolsWithAvg.length; i++) {
                const school = schoolsWithAvg[i];
                if (i > 0 && previousScore !== null && school.averageScore < previousScore) {
                    currentPlace = i + 1;
                }
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: school._id },
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
                previousScore = school.averageScore;
            }

            if (bulkOperations.length > 0) {
                await School.bulkWrite(bulkOperations);
                console.log(`✅ Обновлено место в рейтинге для ${bulkOperations.length} школ`);
            }

        } catch (error) {
            console.error("❌ Ошибка при обновлении места в рейтинге школ:", error);
            throw error;
        }
    }
    async findById(id: string): Promise<ISchool | null> {
        return await School.findById(id).populate('district');
    }

    async findByCode(code: number): Promise<ISchool | null> {
        return await School.findOne({ code });
    }

    async create(schoolData: ISchoolCreate): Promise<ISchool> {
        // Remove empty _id if present
        const cleanData = { ...schoolData };
        if ('_id' in cleanData && (!cleanData._id || cleanData._id === '')) {
            delete (cleanData as any)._id;
        }
        
        const school = new School(cleanData);
        return await school.save();
    }

    async update(id: string, updateData: Partial<ISchoolCreate>): Promise<ISchool> {
        const updatedSchool = await School.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('district');

        if (!updatedSchool) {
            throw new Error('School not found');
        }

        return updatedSchool;
    }

    async delete(id: string): Promise<void> {
        // Delete associated teachers and students first
        const teachers = await Teacher.find({ school: id });
        const students = await Student.find({ school: id });
        
        if (teachers.length > 0) {
            await Teacher.deleteMany({ school: id });
        }
        
        if (students.length > 0) {
            const studentIds = students.map(s => s._id);
            await StudentResult.deleteMany({ student: { $in: studentIds } });
            await Student.deleteMany({ school: id });
        }

        const result = await School.findByIdAndDelete(id);
        if (!result) {
            throw new Error('School not found');
        }
    }

    async deleteBulk(ids: Types.ObjectId[]): Promise<BulkOperationResult> {
        // Delete associated data first
        for (const id of ids) {
            await this.delete(id.toString());
        }

        return {
            insertedCount: 0,
            modifiedCount: 0,
            deletedCount: ids.length,
            errors: []
        };
    }

    async getFilteredSchools(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: ISchool[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            School.find(filter)
                .collation({ locale: 'az', strength: 2 })
                .populate('district')
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            School.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    async getSchoolsForFilter(filters: FilterOptions): Promise<ISchool[]> {
        const filter = this.buildFilter(filters);
        
        return await School.find(filter)
            .sort({ name: 1 });
    }

    async processSchoolsFromExcel(filePath: string): Promise<FileProcessingResult<ISchool>> {
        const processedData: ISchool[] = [];
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
                code: Number(row[2]),
                name: String(row[3]),
                address: ''
            }));

            // Filter correct schools (school code must be 5 digits: 10000-99999)
            const correctSchoolsToInsert = dataToInsert.filter(data => data.code > 9999);
            const incorrectSchoolCodes = dataToInsert
                .filter(data => data.code <= 9999)
                .map(data => data.code);

            // Check existing schools
            const existingSchoolCodes = await this.checkExistingSchoolCodes(
                correctSchoolsToInsert.map(data => data.code)
            );
            
            const newSchools = existingSchoolCodes.length > 0
                ? correctSchoolsToInsert.filter(data => !existingSchoolCodes.includes(data.code))
                : correctSchoolsToInsert;

            // Separate schools without district codes
            const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
            const schoolCodesWithoutDistrictCodes = newSchools
                .filter(item => item.districtCode === 0)
                .map(item => item.code);

            // Check which districts exist
            const existingDistricts = await District.find({ code: { $in: districtCodes } });
            const existingDistrictCodes = existingDistricts.map(d => d.code);
            const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code));

            const districtMap = new Map(existingDistricts.map(d => [d.code, d._id as Types.ObjectId]));

            // Filter schools to save (only those with valid district)
            const schoolsToSave = newSchools.filter(
                item =>
                    item.code > 0 &&
                    !missingDistrictCodes.includes(item.districtCode) &&
                    !schoolCodesWithoutDistrictCodes.includes(item.code)
            ).map(item => ({
                name: item.name,
                address: item.address,
                code: item.code,
                districtCode: item.districtCode,
                district: districtMap.get(item.districtCode),
                active: true
            }));

            // Save schools using bulkWrite with upsert
            if (schoolsToSave.length > 0) {
                const results = await School.collection.bulkWrite(
                    schoolsToSave.map(school => ({
                        updateOne: {
                            filter: { code: school.code },
                            update: { $set: school },
                            upsert: true
                        }
                    }))
                );

                // Fetch created/updated schools for response
                const createdCodes = schoolsToSave.map(s => s.code);
                const savedSchools = await School.find({ code: { $in: createdCodes } });
                processedData.push(...savedSchools.map(s => s.toObject() as ISchool));
            }

            // Clean up
            deleteFile(filePath);

            return {
                processedData,
                errors,
                skippedItems,
                validationErrors: {
                    incorrectSchoolCodes,
                    missingDistrictCodes: [...new Set(missingDistrictCodes)],
                    schoolCodesWithoutDistrictCodes,
                    existingSchoolCodes
                }
            };
        } catch (error) {
            deleteFile(filePath);
            throw error;
        }
    }

    async checkExistingSchoolCodes(codes: number[]): Promise<number[]> {
        const existingCodes = await School.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = { active: true }; // По умолчанию только активные

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 5);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        if (filters.search) {
            // Search by school name (case-insensitive)
            filter.name = { $regex: filters.search, $options: 'i' };
        }

        if (filters.active !== undefined) {
            filter.active = filters.active;
        }

        return filter;
    }

    async importLegacySchools(records: any[]): Promise<{
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
        details: { skippedCodes: number[]; errorMessages: string[] };
    }> {
        const LEGACY_YEAR = 2024;
        let inserted = 0;
        let updated = 0;
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

                const existing = await School.findOne({ code });
                if (existing) {
                    // Already has a 2024 rating → truly skip
                    const has2024 = (existing.ratings || []).some((r: any) => r.year === LEGACY_YEAR);
                    if (has2024) {
                        skipped++;
                        skippedCodes.push(code);
                        continue;
                    }
                    // Missing 2024 rating → add it
                    const score        = typeof record.score        === 'number' ? record.score        : 0;
                    const averageScore = typeof record.averageScore === 'number' ? record.averageScore : 0;
                    await School.updateOne(
                        { _id: existing._id },
                        { $push: { ratings: { year: LEGACY_YEAR, score, averageScore, place: null } } }
                    );
                    updated++;
                    continue;
                }

                // Resolve district by districtCode
                const districtCode = Number(record.districtCode);
                let districtId: Types.ObjectId | null = null;
                if (districtCode && !isNaN(districtCode)) {
                    const districtDoc = await District.findOne({ code: districtCode });
                    if (districtDoc) {
                        districtId = districtDoc._id as Types.ObjectId;
                    }
                }

                const score = typeof record.score === 'number' ? record.score : 0;
                const averageScore = typeof record.averageScore === 'number' ? record.averageScore : 0;

                const schoolData: any = {
                    code,
                    name: record.name || '',
                    address: record.address || '',
                    districtCode: districtCode || 0,
                    district: districtId,
                    active: record.active !== undefined ? Boolean(record.active) : true,
                    ratings: [{ year: LEGACY_YEAR, score, averageScore, place: null }],
                };

                await School.create(schoolData);
                inserted++;
            } catch (err: any) {
                errors++;
                errorMessages.push(`School code ${record.code}: ${err.message}`);
            }
        }

        return { inserted, updated, skipped, errors, details: { skippedCodes, errorMessages } };
    }
}

// Legacy functions for backward compatibility
const schoolService = new SchoolService();

export const getFiltredSchools = async (req: Request): Promise<{ data: ISchool[], totalCount: number }> => {
    const pagination = RequestParser.parsePagination(req);
    const filters = RequestParser.parseFilterOptions(req);
    const sort = RequestParser.parseSorting(req, 'averageScore', 'desc');

    return await schoolService.getFilteredSchools(pagination, filters, sort);
}

export const checkExistingSchools = async (codes: number[]): Promise<ISchool[]> => {
    try {
        const result = await School.find({ code: { $in: codes } });
        return result;
    } catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск школ!");
    }
}

export const checkExistingSchoolCodes = async (codes: number[]): Promise<number[]> => {
    return await schoolService.checkExistingSchoolCodes(codes);
}

export const deleteSchoolById = async (id: string): Promise<void> => {
    return await schoolService.delete(id);
}

export const deleteSchoolsByIds = async (ids: string[]): Promise<BulkOperationResult> => {
    const objectIds = ids.map(id => new Types.ObjectId(id));
    return await schoolService.deleteBulk(objectIds);
}
