import { DeleteResult, Types } from "mongoose";
import School, { ISchool } from "../models/school.model";
import Teacher from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { Request } from "express";
import { SchoolRepository } from '../repositories/school.repository';
import { CreateSchoolDto, UpdateSchoolDto } from '../dtos/school.dto';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors';
import District from '../models/district.model';

export const getFiltredSchools = async (req: Request): Promise<{ data: ISchool[], totalCount: number }> => {
    try {
        const page: number = parseInt(req.query.page as string) || 1;
        const size: number = parseInt(req.query.size as string) || 10;
        const skip: number = (page - 1) * size;
        const districtIds: Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const sortColumn: string = req.query.sortColumn?.toString() || 'averageScore';
        const sortDirection: string = req.query.sortDirection?.toString() || 'desc';
        const code: number = req.query.code ? parseInt(req.query.code as string) : 0;

        const filter: any = {};

        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }
        if (code) {
            const codeString = code.toString().padEnd(5, '0');
            const codeStringEnd = code.toString().padEnd(5, '9');

            filter.code = { $gte: codeString, $lte: codeStringEnd };
        }

        const [data, totalCount] = await Promise.all([
            School.find(filter)
                .populate('district')
                .sort({ [sortColumn]: sortDirection === 'asc' ? 1 : -1 })
                .skip(skip)
                .limit(size),
            School.countDocuments(filter)
        ]);

        return { data, totalCount };
    }
    catch (error) {
        throw error;
    }
}

export const checkExistingSchools = async (codes: number[]): Promise<ISchool[]> => {
    try {
        const result = await School.find({ code: { $in: codes } });
        return result;
    } catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск!");
    }
}

export const checkExistingSchoolCodes = async (codes: number[]): Promise<number[]> => {
    try {
        // Используем .distinct() для получения массива уникальных кодов
        const existingCodes = await School.distinct("code", { code: { $in: codes } });
        return existingCodes;
    } catch (error) {
        console.error("Ошибка при поиске:", error);
        throw new Error("Не удалось осуществить поиск!");
    }
};

export const deleteSchoolById = async (schoolId: string): Promise<DeleteResult> => {
    try {
        const students = await Student.find({ school: schoolId });
        const studentIds = students.map(student => student._id);
        await StudentResult.deleteMany({ student: { $in: studentIds } });
        await Student.deleteMany({ school: schoolId });
        await Teacher.deleteMany({ school: schoolId });
        const result = await School.deleteOne({ _id: schoolId });
        return result;
    } catch (error) {
        throw error;
    }
}

export const deleteSchoolsByIds = async (schoolIds: string[]): Promise<DeleteResult> => {
    try {
        const students = await Student.find({ school: { $in: schoolIds } });
        const studentIds = students.map(student => student._id);
        await StudentResult.deleteMany({ student: { $in: studentIds } });
        await Student.deleteMany({ school: { $in: schoolIds } });
        await Teacher.deleteMany({ school: { $in: schoolIds } });
        const result = await School.deleteMany({ _id: { $in: schoolIds } });
        return result;
    } catch (error) {
        throw error;
    }
}

export class SchoolService {
    constructor(private readonly schoolRepository: SchoolRepository) {}

    async getSchools(req: Request): Promise<{ data: ISchool[]; totalCount: number }> {
        const schools = await this.schoolRepository.find(req.query);
        return { data: schools, totalCount: schools.length };
    }

    async getSchool(id: string): Promise<ISchool> {
        const school = await this.schoolRepository.findById(id);
        if (!school) {
            throw new NotFoundError('School not found');
        }
        return school;
    }

    async createSchool(createSchoolDto: CreateSchoolDto): Promise<ISchool> {
        // Check if school already exists
        const existingSchool = await this.schoolRepository.findByName(createSchoolDto.name);
        if (existingSchool) {
            throw new ConflictError('School with this name already exists');
        }

        // Validate district
        const district = await District.findById(createSchoolDto.district);
        if (!district) {
            throw new ValidationError('District not found');
        }

        return this.schoolRepository.create(createSchoolDto);
    }

    async updateSchool(id: string, updateSchoolDto: UpdateSchoolDto): Promise<ISchool> {
        const school = await this.schoolRepository.findById(id);
        if (!school) {
            throw new NotFoundError('School not found');
        }

        // Validate district if it's being updated
        if (updateSchoolDto.district) {
            const district = await District.findById(updateSchoolDto.district);
            if (!district) {
                throw new ValidationError('District not found');
            }
        }

        const updatedSchool = await this.schoolRepository.update(id, updateSchoolDto);
        if (!updatedSchool) {
            throw new NotFoundError('School not found');
        }

        return updatedSchool;
    }

    async deleteSchool(id: string): Promise<boolean> {
        const school = await this.schoolRepository.findById(id);
        if (!school) {
            throw new NotFoundError('School not found');
        }
        return this.schoolRepository.delete(id);
    }

    async deleteSchools(ids: string[]): Promise<boolean> {
        return this.schoolRepository.deleteMany({ _id: { $in: ids } });
    }
}