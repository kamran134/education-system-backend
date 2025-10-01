import { Request } from "express";
import Teacher, { ITeacher, ITeacherInput, ITeacherCreate } from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import { DeleteResult, Types } from "mongoose";
import { deleteStudentsByTeacherId, deleteStudentsByTeachersIds } from "./student.service";
import { PaginationOptions, FilterOptions, SortOptions, BulkOperationResult, FileProcessingResult } from "../types/common.types";
import { RequestParser } from "../utils/request-parser.util";
import { readExcel } from "./excel.service";
import { deleteFile } from "./file.service";

export class TeacherService {
    /**
     * Обновляет статистику по учителям: studentCount, score, averageScore
     */
    async updateTeachersStats(): Promise<void> {
        // Сначала обнуляем статистику всех учителей
        console.log("🧹 Обнуляем статистику учителей...");
        await Teacher.updateMany({}, { 
            score: 0, 
            averageScore: 0, 
            studentCount: 0 
        });
        
        // Получаем всех студентов с teacher и score
        const Student = require('../models/student.model').default;
        const students = await Student.find({}, { teacher: 1, score: 1 });
        // Группируем по teacher
        const statsMap = new Map<string, { sum: number, count: number }>();
        for (const student of students) {
            const teacherId = student.teacher?.toString();
            if (!teacherId) continue;
            const score = typeof student.score === 'number' ? student.score : 0;
            if (!statsMap.has(teacherId)) {
                statsMap.set(teacherId, { sum: 0, count: 0 });
            }
            const stat = statsMap.get(teacherId)!;
            stat.sum += score;
            stat.count += 1;
        }
        // Обновляем каждого учителя
        for (const [teacherId, { sum, count }] of statsMap.entries()) {
            const average = count > 0 ? sum / count : 0;
            await Teacher.findByIdAndUpdate(teacherId, {
                studentCount: count,
                score: sum,
                averageScore: average
            });
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
            .sort({ code: 1 });
    }

    async processTeachersFromExcel(filePath: string): Promise<FileProcessingResult<ITeacher>> {
        const processedData: ITeacher[] = [];
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
                schoolCode: Number(row[2]) || 0,
                code: Number(row[3]),
                fullname: String(row[4])
            }));

            // Filter correct teachers
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

            // Validate districts and schools
            const districtCodes = newTeachers.filter(item => item.districtCode > 0).map(item => item.districtCode);
            const schoolCodes = newTeachers.filter(item => item.schoolCode > 0).map(item => item.schoolCode);

            const existingDistricts = await District.find({ code: { $in: districtCodes } });
            const existingSchools = await School.find({ code: { $in: schoolCodes } });

            const schoolMap = new Map(existingSchools.map(s => [s.code, s]));
            const districtMap = new Map(existingDistricts.map(d => [d.code, d]));

            // Create teachers
            const teachersToCreate: ITeacherCreate[] = newTeachers.map(teacherData => {
                const school = schoolMap.get(teacherData.schoolCode);
                const district = districtMap.get(teacherData.districtCode);

                return {
                    code: teacherData.code,
                    fullname: teacherData.fullname,
                    school: school?._id as Types.ObjectId,
                    district: district?._id as Types.ObjectId,
                    active: true
                };
            });

            const createdTeachers = await Teacher.insertMany(teachersToCreate);
            processedData.push(...createdTeachers.map(t => t.toObject() as ITeacher));

            // Clean up
            deleteFile(filePath);

            return {
                processedData,
                errors: incorrectTeacherCodes.map(code => `Invalid teacher code: ${code}`),
                skippedItems: existingTeacherCodes.map(code => ({ code, reason: 'Already exists' }))
            };
        } catch (error) {
            deleteFile(filePath);
            throw error;
        }
    }

    async repairTeacherAssignments(): Promise<{ repairedTeachers: number[], teachersWithoutSchool: number[] }> {
        const teachers = await Teacher.find({});
        const repairedTeachers: number[] = [];
        const teachersWithoutSchool: number[] = [];
        const bulkOps: any[] = [];

        for (const teacher of teachers) {
            const teacherCode = teacher.code.toString();

            if (teacherCode.length !== 7) {
                continue;
            }

            let isUpdated = false;
            let newDistrictId: Types.ObjectId | null = null;
            let newSchoolId: Types.ObjectId | null = null;

            // Check and fix district
            if (!teacher.district) {
                const districtCode = teacherCode.substring(0, 3);
                const district = await District.findOne({ code: parseInt(districtCode) });
                if (district) {
                    newDistrictId = district._id as Types.ObjectId;
                    isUpdated = true;
                }
            }

            // Check and fix school
            if (!teacher.school) {
                const schoolCode = teacherCode.substring(0, 5);
                const school = await School.findOne({ code: parseInt(schoolCode) });
                if (school) {
                    newSchoolId = school._id as Types.ObjectId;
                    isUpdated = true;
                } else {
                    teachersWithoutSchool.push(teacher.code);
                }
            }

            if (isUpdated) {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: teacher._id },
                        update: { $set: { district: newDistrictId, school: newSchoolId } }
                    }
                });
                repairedTeachers.push(teacher.code);
            }
        }

        if (bulkOps.length > 0) {
            await Teacher.bulkWrite(bulkOps);
        }

        return { repairedTeachers, teachersWithoutSchool };
    }

    async checkExistingTeacherCodes(codes: number[]): Promise<number[]> {
        const existingCodes = await Teacher.distinct("code", { code: { $in: codes } });
        return existingCodes;
    }

    private buildFilter(filters: FilterOptions): any {
        const filter: any = {};

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

        if (filters.active !== undefined) {
            filter.active = filters.active;
        }

        return filter;
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
