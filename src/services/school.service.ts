import { DeleteResult, Types } from "mongoose";
import School, { ISchool, ISchoolInput, ISchoolCreate } from "../models/school.model";
import District from "../models/district.model";
import Teacher from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";

import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { buildCommonFilter } from "../utils/filter.util";
import { updateEntityStats } from "../utils/stats.utils";
import { updateEntityPlaces } from "../utils/ranking.util";

export class SchoolService {
    /**
     * Обновляет статистику по школам: studentCount, score, averageScore
     */
    async updateSchoolsStats(): Promise<void> {
        await updateEntityStats(School, 'school', 'schools', 'школ', () => updateEntityPlaces(School, 'школ', { active: true }));
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
            await deleteFile(filePath).catch(() => {});

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
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    async checkExistingSchoolCodes(codes: number[]): Promise<number[]> {
        const existingCodes = await School.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }

    private buildFilter(filters: FilterOptions): any {
        const filter = buildCommonFilter(filters, 5);
        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
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

export const schoolService = new SchoolService();
