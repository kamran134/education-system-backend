import { DeleteResult, Types } from "mongoose";
import School, { ISchool } from "../models/school.model";
import Teacher from "../models/teacher.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { Request } from "express";

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