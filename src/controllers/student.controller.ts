import { Request, Response, NextFunction } from 'express';
import Student, { IStudent } from "../models/student.model";
import District from "../models/district.model";
import School from "../models/school.model";
import Teacher from "../models/teacher.model";
import StudentResult, { IStudentResult } from "../models/studentResult.model";
import { deleteStudentsByIds, getFiltredStudents } from "../services/student.service";
import { deleteStudentResultsByStudentId } from "../services/studentResult.service";
import { StudentService } from '../services/student.service';
import { StudentRepository } from '../repositories/student.repository';
import { CreateStudentDto, UpdateStudentDto } from '../dtos/student.dto';
import { validateDto } from '../middleware/validation.middleware';
import { AppError } from '../utils/errors';

const studentRepository = new StudentRepository(Student);
const studentService = new StudentService(studentRepository);

export const getStudents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await studentService.getStudents(req);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const getStudent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const student = await studentService.getStudent(req.params.id);
        res.status(200).json(student);
    } catch (error) {
        next(error);
    }
};

// export const getStudentsForStats = async (req: Request, res: Response) => {
//     try {
//         const { data, totalCount } = await getFiltredStudents(req); 
//         res.status(200).json({ data, totalCount });
//     }
//     catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Tələbələrin alınmasında xəta", error });
//     }
// }

export const searchStudents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const searchString = req.params.searchString || '';
        const result = await studentService.searchStudents(searchString);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const createStudent = [
    validateDto(CreateStudentDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const student = await studentService.createStudent(req.body);
            res.status(201).json(student);
        } catch (error) {
            next(error);
        }
    }
];

export const updateStudent = [
    validateDto(UpdateStudentDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const student = await studentService.updateStudent(req.params.id, req.body);
            res.status(200).json(student);
        } catch (error) {
            next(error);
        }
    }
];

export const deleteStudent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const success = await studentService.deleteStudent(req.params.id);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'Student not found');
        }
    } catch (error) {
        next(error);
    }
};

export const deleteStudents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            throw new AppError(400, 'Invalid request body. Expected an array of student IDs.');
        }
        const success = await studentService.deleteStudents(ids);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'No students found to delete');
        }
    } catch (error) {
        next(error);
    }
};

export const deleteAllStudents = async (req: Request, res: Response) => {
    try {
        const studentResult = await StudentResult.deleteMany();
        const result = await Student.deleteMany();
        res.status(200).json({ message: `${result.deletedCount} şagird və ${studentResult.deletedCount} onların nəticələri bazadan silindi!` });
    } catch (error) {
        console.error(error);
        res.status(500).json(error);
    }
}

export const repairStudents = async (req: Request, res: Response) => {
    try {
        const students = await Student.find().populate('district school teacher');

        const studentsWithoutDistrict: string[] = [];
        const studentsWithoutSchool: string[] = [];
        const studentsWithoutTeacher: string[] = [];
        const repairedStudents: string[] = [];

        for (let student of students) {
            const studentCode: string = student.code.toString();
            if (studentCode.length !== 10) continue;

            let isUpdated = false;

            if (!student.district) {
                const districtCode = studentCode.substring(0, 3);
                const district = await District.findOne({ code: districtCode });

                if (district) {
                    student.district = district;
                    isUpdated = true;
                } else {
                    studentsWithoutDistrict.push(student.code.toString());
                }
            }

            if (!student.school) {
                const schoolCode = studentCode.substring(0, 5);
                const school = await School.findOne({ code: schoolCode });

                if (school) {
                    student.school = school;
                    isUpdated = true;
                } else {
                    studentsWithoutSchool.push(student.code.toString());
                }
            }

            if (!student.teacher) {
                const teacherCode = studentCode.substring(0, 7);
                const teacher = await Teacher.findOne({ code: teacherCode });

                if (teacher) {
                    student.teacher = teacher;
                    isUpdated = true;
                } else {
                    studentsWithoutTeacher.push(student.code.toString());
                }
            }

            if (isUpdated) {
                await student.save();
                repairedStudents.push(student.code.toString());
            }
        }

        res.status(200).json({
            message: "Tələbə məlumatları yeniləndi",
            repairedStudents,
            studentsWithoutDistrict,
            studentsWithoutSchool,
            studentsWithoutTeacher
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Tələbələrin alınmasında xəta", error });
    }
}