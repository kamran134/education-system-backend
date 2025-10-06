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

export class SchoolService {
    /**
     * Обновляет статистику по школам: studentCount, score, averageScore
     */
    async updateSchoolsStats(): Promise<void> {
        // Сначала обнуляем статистику всех школ
        console.log("🧹 Обнуляем статистику школ...");
        await School.updateMany({}, { 
            score: 0, 
            averageScore: 0, 
            studentCount: 0 
        });
        
        // Получаем всех студентов с school и score
        const students = await Student.find({}, { school: 1, score: 1 });
        // Группируем по school
        const statsMap = new Map<string, { sum: number, count: number }>();
        for (const student of students) {
            const schoolId = student.school?.toString();
            if (!schoolId) continue;
            const score = typeof student.score === 'number' ? student.score : 0;
            if (!statsMap.has(schoolId)) {
                statsMap.set(schoolId, { sum: 0, count: 0 });
            }
            const stat = statsMap.get(schoolId)!;
            stat.sum += score;
            stat.count += 1;
        }
        // Обновляем каждую школу
        for (const [schoolId, { sum, count }] of statsMap.entries()) {
            const average = count > 0 ? sum / count : 0;
            await School.findByIdAndUpdate(schoolId, {
                score: sum,
                averageScore: average
            });
        }

        // Обновляем studentCount из суммы учителей
        console.log("👥 Обновляем количество студентов школ из суммы учителей...");
        await this.updateSchoolStudentCountFromTeachers();

        // Обновляем место в рейтинге (place) для всех школ
        console.log("🏆 Обновляем рейтинг школ (place)...");
        await this.updateSchoolPlaces();
    }

    /**
     * Обновляет studentCount школ из суммы studentCount их учителей
     */
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

    /**
     * Обновляет место в рейтинге (place) для всех школ на основе их averageScore
     */
    private async updateSchoolPlaces(): Promise<void> {
        try {
            // Получаем все школы, отсортированные по averageScore в убывающем порядке
            const schools = await School.find({ averageScore: { $exists: true }, active: true })
                                       .sort({ averageScore: -1, code: 1 }) // сортируем по averageScore убывание, при равенстве по коду
                                       .select('_id averageScore code');

            if (schools.length === 0) {
                console.log("Нет школ с averageScore для установки места в рейтинге.");
                return;
            }

            // Подготавливаем bulk операции для обновления места
            const bulkOperations = [];
            let currentPlace = 0;
            let previousScore = null;

            for (let i = 0; i < schools.length; i++) {
                const school = schools[i];
                
                // Если это первая школа или балл изменился
                if (i === 0 || (previousScore !== null && school.averageScore < previousScore)) {
                    // Место = позиция в отсортированном списке + 1
                    currentPlace++;
                }
                // Если балл такой же, как у предыдущей, место остается тем же

                bulkOperations.push({
                    updateOne: {
                        filter: { _id: school._id },
                        update: { $set: { place: currentPlace } }
                    }
                });

                previousScore = school.averageScore;
            }

            // Выполняем массовое обновление мест
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
        const school = new School(schoolData);
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
            if (!data || data.length < 4) {
                throw new Error('Invalid Excel file format');
            }

            const rows = data.slice(3); // Skip header rows
            const dataToInsert = rows.map(row => ({
                districtCode: Number(row[1]) || 0,
                code: Number(row[2]),
                name: String(row[3]),
                address: String(row[4]) || '',
                studentCount: Number(row[5]) || 0
            }));

            // Filter correct schools
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

            // Validate districts
            const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
            const existingDistricts = await District.find({ code: { $in: districtCodes } });
            const districtMap = new Map(existingDistricts.map(d => [d.code, d]));

            // Create schools
            const schoolsToCreate: ISchoolCreate[] = newSchools.map(schoolData => {
                const district = districtMap.get(schoolData.districtCode);

                return {
                    code: schoolData.code,
                    name: schoolData.name,
                    address: schoolData.address,
                    districtCode: schoolData.districtCode,
                    district: district?._id as Types.ObjectId,
                    studentCount: schoolData.studentCount || 0,
                    active: true
                };
            });

            const createdSchools = await School.insertMany(schoolsToCreate);
            processedData.push(...createdSchools.map(s => s.toObject() as ISchool));

            // Обновляем studentCount для существующих школ из Excel
            if (existingSchoolCodes.length > 0) {
                const existingSchoolsToUpdate = correctSchoolsToInsert.filter(data => existingSchoolCodes.includes(data.code));
                
                const bulkUpdateOperations = existingSchoolsToUpdate.map(schoolData => ({
                    updateOne: {
                        filter: { code: schoolData.code },
                        update: { $set: { studentCount: schoolData.studentCount || 0 } }
                    }
                }));

                if (bulkUpdateOperations.length > 0) {
                    await School.bulkWrite(bulkUpdateOperations);
                    console.log(`✅ Обновлено studentCount для ${bulkUpdateOperations.length} существующих школ`);
                }
            }

            // Clean up
            deleteFile(filePath);

            return {
                processedData,
                errors: incorrectSchoolCodes.map(code => `Invalid school code: ${code}`),
                skippedItems: existingSchoolCodes.map(code => ({ code, reason: 'Already exists' }))
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
        const filter: any = {};

        if (filters.districtIds && filters.districtIds.length > 0) {
            filter.district = { $in: filters.districtIds };
        }

        if (filters.code) {
            const { start, end } = RequestParser.parseCodeRange(filters.code, 5);
            filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
        }

        if (filters.active !== undefined) {
            filter.active = filters.active;
        }

        return filter;
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
