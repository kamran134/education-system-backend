import { Types } from "mongoose";
import District, { IDistrict, IDistrictCreate } from "../models/district.model";
import School from "../models/school.model";
import Teacher from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";
import { escapeRegex } from "../utils/validation.util";
import { updateEntityStats } from "../utils/stats.utils";
import { updateEntityPlaces } from "../utils/ranking.util";

export class DistrictService {
    /**
     * Обновляет статистику по районам: studentCount, score, averageScore
     */
    async updateDistrictsStats(): Promise<void> {
        await updateEntityStats(District, 'district', 'districts', 'районов', () => updateEntityPlaces(District, 'районов'));
    }

    async findById(id: string): Promise<IDistrict | null> {
        return await District.findById(id);
    }

    async findByCode(code: number): Promise<IDistrict | null> {
        return await District.findOne({ code });
    }

    async create(districtData: IDistrictCreate): Promise<IDistrict> {
        const district = new District(districtData);
        return await district.save();
    }

    async update(id: string, updateData: Partial<IDistrictCreate>): Promise<IDistrict> {
        const updatedDistrict = await District.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedDistrict) {
            throw new Error('District not found');
        }

        return updatedDistrict;
    }

    async delete(id: string): Promise<void> {
        // Delete associated schools, teachers and students first
        const schools = await School.find({ district: id });
        
        if (schools.length > 0) {
            const schoolIds = schools.map(s => s._id);
            
            // Delete teachers
            await Teacher.deleteMany({ school: { $in: schoolIds } });
            
            // Delete student results first, then students
            const students = await Student.find({ school: { $in: schoolIds } });
            if (students.length > 0) {
                const studentIds = students.map(s => s._id);
                await StudentResult.deleteMany({ student: { $in: studentIds } });
                await Student.deleteMany({ school: { $in: schoolIds } });
            }
            
            // Delete schools
            await School.deleteMany({ district: id });
        }

        const result = await District.findByIdAndDelete(id);
        if (!result) {
            throw new Error('District not found');
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

    async getFilteredDistricts(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<{ data: IDistrict[], totalCount: number }> {
        const filter = this.buildFilter(filters);
        
        const sortOptions: any = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === 'asc' ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            District.find(filter)
                .collation({ locale: 'az', strength: 2 })
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            District.countDocuments(filter)
        ]);

        return { data, totalCount };
    }

    async getDistrictsForFilter(filters: FilterOptions): Promise<IDistrict[]> {
        const filter = this.buildFilter(filters);
        
        return await District.find(filter)
            .sort({ name: 1 });
    }

    async processDistrictsFromExcel(filePath: string): Promise<FileProcessingResult<IDistrict>> {
        const processedData: IDistrict[] = [];
        const errors: string[] = [];
        const skippedItems: any[] = [];

        try {
            const data = readExcel(filePath);
            if (!data || data.length < 4) {
                throw new Error('Invalid Excel file format');
            }

            const rows = data.slice(3); // Skip header rows
            const dataToInsert = rows.map(row => ({
                code: Number(row[1]),
                name: String(row[2]),
                studentCount: Number(row[3]) || 0
            }));

            // Filter valid districts
            const validDistricts = dataToInsert.filter(data => data.code > 0 && data.name);

            // Check existing districts
            const existingDistrictCodes = await this.checkExistingDistrictCodes(
                validDistricts.map(data => data.code)
            );
            
            const newDistricts = existingDistrictCodes.length > 0
                ? validDistricts.filter(data => !existingDistrictCodes.includes(data.code))
                : validDistricts;

            // Create districts
            const districtsToCreate: IDistrictCreate[] = newDistricts.map(districtData => ({
                code: districtData.code,
                name: districtData.name,
                studentCount: districtData.studentCount || 0,
                active: true
            }));

            const createdDistricts = await District.insertMany(districtsToCreate);
            processedData.push(...createdDistricts.map(d => d.toObject() as IDistrict));

            // Обновляем studentCount для существующих районов из Excel
            if (existingDistrictCodes.length > 0) {
                const existingDistrictsToUpdate = validDistricts.filter(data => existingDistrictCodes.includes(data.code));
                
                const bulkUpdateOperations = existingDistrictsToUpdate.map(districtData => ({
                    updateOne: {
                        filter: { code: districtData.code },
                        update: { $set: { studentCount: districtData.studentCount || 0 } }
                    }
                }));

                if (bulkUpdateOperations.length > 0) {
                    await District.bulkWrite(bulkUpdateOperations);
                    console.log(`✅ Обновлено studentCount для ${bulkUpdateOperations.length} существующих районов`);
                }
            }

            // Clean up
            await deleteFile(filePath).catch(() => {});

            return {
                processedData,
                errors,
                skippedItems: existingDistrictCodes.map(code => ({ code, reason: 'Already exists' }))
            };
        } catch (error) {
            await deleteFile(filePath).catch(() => {});
            throw error;
        }
    }

    async checkExistingDistrictCodes(codes: number[]): Promise<number[]> {
        const existingCodes = await District.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }

    async countDistrictsRates(): Promise<void> {
        try {
            console.log("🔄 Подсчёт коэффициентов районов...");

            const studentResults = await StudentResult.find().populate("student exam");

            const districtCounts = new Map<string, number>();
            const examDistrictIds = new Set<string>();
            
            for (const result of studentResults) {
                const districtId = result.student.district?.toString();
                const examId = result.exam?.toString();
                
                if (districtId && examId) {
                    const key = `${districtId}-${examId}`;
                    if (!examDistrictIds.has(key)) {
                        examDistrictIds.add(key);
                        districtCounts.set(districtId, (districtCounts.get(districtId) || 0) + 1);
                    }
                }
            }

            // Update districts with counts
            for (const [districtId, count] of districtCounts.entries()) {
                await District.findByIdAndUpdate(districtId, { 
                    examCount: count,
                    updatedAt: new Date()
                });
            }

            console.log("✅ Коэффициенты районов обновлены");
        } catch (error) {
            console.error("Ошибка при подсчёте коэффициентов:", error);
            throw new Error("Не удалось подсчитать коэффициенты районов!");
        }
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {};

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 2);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        if (filters.search) {
            // Search by district name (case-insensitive)
            filter.name = { $regex: escapeRegex(filters.search), $options: 'i' };
        }

        if (filters.active !== undefined) {
            filter.active = filters.active;
        }

        return filter;
    }
}

export const districtService = new DistrictService();
