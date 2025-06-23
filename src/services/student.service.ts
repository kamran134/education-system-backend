import { DeleteResult, Types } from "mongoose";
import { IStudent, IStudentInput } from "../models/student.model";
import Teacher, { ITeacher } from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import { Request } from "express";
import { deleteStudentResultsByStudentId } from "./studentResult.service";
import { StudentRepository } from '../repositories/student.repository';
import { CreateStudentDto, UpdateStudentDto } from '../dtos/student.dto';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors';

export const assignTeacherToStudent = async (student: IStudentInput) => {
    try {
        const teacher: ITeacher | null = await Teacher.findOne({ code: Math.floor(student.code / 1000) });
        if (teacher) {
            student.teacher = teacher._id as Types.ObjectId;
            const studentSchool = await School.findById(teacher.school);
            if (studentSchool) {
                student.school = studentSchool._id as Types.ObjectId;
                const studentDistrict = await District.findById(studentSchool.district);
                if (studentDistrict) {
                    student.district = studentDistrict._id as Types.ObjectId;
                }
            }
        } else {
            console.log(`Uğursuz: ${student.code}`);
        }
    } catch (error) {
        console.error(`Xəta: ${error}`);
    }
}

export const getFiltredStudents = async (req: Request): Promise<{ data: IStudent[], totalCount: number }> => {
    try {
        const page: number = parseInt(req.query.page as string) || 1;
        const size: number = parseInt(req.query.size as string) || 100;
        const skip: number = (page - 1) * size;
        const districtIds: Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const schoolIds: Types.ObjectId[] = req.query.schoolIds
            ? (req.query.schoolIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const teacherIds: Types.ObjectId[] = req.query.teacherIds
            ? (req.query.teacherIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const grades: number[] = (req.query.grades?.toString() || '').split(',').map(grade => parseInt(grade)).filter(grade => !isNaN(grade));
        const examIds: Types.ObjectId[] = req.query.examIds
            ? (req.query.examIds as string).split(',').map(id => new Types.ObjectId(id))
            : [];
        const defective: boolean = req.query.defective?.toString().toLowerCase() === 'true';
        const sortColumn: string = req.query.sortColumn?.toString() || 'averageScore';
        const sortDirection: string = req.query.sortDirection?.toString() || 'desc';
        const code: number = req.query.code ? parseInt(req.query.code as string) : 0;

        const filter: any = {};

        if (defective) {
            filter.$or = [
                { teacher: null },
                { school: null },
                { district: null },
            ];
        }
        else {
            if (districtIds.length > 0 && schoolIds.length == 0) {
                filter.district = { $in: districtIds };
            }
            else if (schoolIds.length > 0 && teacherIds.length == 0) {
                filter.school = { $in: schoolIds };
            }
            else if (teacherIds.length > 0) {
                filter.teacher = { $in: teacherIds };
            }
            if (grades.length > 0) {
                filter.grade = { $in: grades }
            }
            if (examIds.length > 0) {
                const studentsInExam = (await StudentResult.find({ exam: { $in: examIds } })).map(res => res.student);
                filter._id = { $in: studentsInExam }
            }
            if (code) {
                const codeString = code.toString().padEnd(10, '0');
                const codeStringEnd = code.toString().padEnd(10, '9');

                filter.code = { $gte: parseInt(codeString), $lte: parseInt(codeStringEnd) };
            }
        }

        const sortOptions: any = {};
        sortOptions[sortColumn] = sortDirection === 'asc' ? 1 : -1;
        console.log(`Sort options: ${JSON.stringify(sortOptions)}`);

        const [data, totalCount] = await Promise.all([
            Student.find(filter)
                .populate('district school teacher')
                .sort(sortOptions)
                .skip(skip)
                .limit(size),
            Student.countDocuments(filter)
        ]);

        return { data, totalCount };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentById = async (id: string) => {
    try {
        Promise.all([
            deleteStudentResultsByStudentId(id),
            Student.findByIdAndDelete(id)
        ]);
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByIds = async (studentIds: string[]): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const [result, studentResults] = await Promise.all([
            Student.deleteMany({ _id: { $in: studentIds } }),
            StudentResult.deleteMany({ student: { $in: studentIds } })
        ]);

        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByTeacherId = async (teacherId: string): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const studentIds = await Student.find({ teacher: teacherId }).distinct('_id');

        const [result, studentResults] = await Promise.all([
            Student.deleteMany({ teacher: teacherId }),
            StudentResult.deleteMany({ student: { $in: studentIds } })
        ]);
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByTeachersIds = async (teacherIds: string[]): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ teacher: { $in: teacherIds } });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ teacher: { $in: teacherIds } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsBySchoolId = async (schoolId: string): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ school: schoolId });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ school: { $in: schoolId } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsBySchoolsIds = async (schoolIds: string[]): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ school: { $in: schoolIds } });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ school: { $in: schoolIds } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export const deleteStudentsByDistrictId = async (districtId: string): Promise<{ result: DeleteResult, studentResults: DeleteResult }> => {
    try {
        const students = await Student.find({ district: districtId });
        const studentIds = students.map(student => student._id);
        const studentResults = await StudentResult.deleteMany({ student: { $in: studentIds } });
        const result = await Student.deleteMany({ district: { $in: districtId } });
        return { result, studentResults };
    } catch (error) {
        throw error;
    }
}

export class StudentService {
    constructor(private readonly studentRepository: StudentRepository) {}

    async getStudents(req: Request): Promise<{ data: IStudent[]; totalCount: number }> {
        const students = await this.studentRepository.find(req.query);
        return { data: students, totalCount: students.length };
    }

    async getStudent(id: string): Promise<IStudent> {
        const student = await this.studentRepository.findById(id);
        if (!student) {
            throw new NotFoundError('Student not found');
        }
        return student;
    }

    async searchStudents(searchString: string): Promise<{ data: IStudent[]; totalCount: number }> {
        const students = await this.studentRepository.searchStudents(searchString);
        return { data: students, totalCount: students.length };
    }

    async createStudent(createStudentDto: CreateStudentDto): Promise<IStudent> {
        // Validate student code
        if (createStudentDto.code.length !== 10) {
            throw new ValidationError('Student code must be exactly 10 digits');
        }

        // Check if student already exists
        const existingStudent = await this.studentRepository.findByCode(createStudentDto.code);
        if (existingStudent) {
            throw new ConflictError('Student with this code already exists');
        }

        // Validate related entities
        if (createStudentDto.district) {
            const district = await District.findById(createStudentDto.district);
            if (!district) {
                throw new ValidationError('District not found');
            }
        }

        if (createStudentDto.school) {
            const school = await School.findById(createStudentDto.school);
            if (!school) {
                throw new ValidationError('School not found');
            }
        }

        if (createStudentDto.teacher) {
            const teacher = await Teacher.findById(createStudentDto.teacher);
            if (!teacher) {
                throw new ValidationError('Teacher not found');
            }
        }

        const studentData: IStudentInput = {
            code: parseInt(createStudentDto.code, 10),
            firstName: createStudentDto.firstName,
            lastName: createStudentDto.lastName,
            middleName: createStudentDto.middleName || '',
            grade: 0, // Default value, should be updated based on your requirements
            teacher: createStudentDto.teacher ? new Types.ObjectId(createStudentDto.teacher) : undefined,
            school: createStudentDto.school ? new Types.ObjectId(createStudentDto.school) : undefined,
            district: createStudentDto.district ? new Types.ObjectId(createStudentDto.district) : undefined
        };

        return this.studentRepository.create(studentData);
    }

    async updateStudent(id: string, updateStudentDto: UpdateStudentDto): Promise<IStudent> {
        const student = await this.studentRepository.findById(id);
        if (!student) {
            throw new NotFoundError('Student not found');
        }

        // Validate related entities if they are being updated
        if (updateStudentDto.district) {
            const district = await District.findById(updateStudentDto.district);
            if (!district) {
                throw new ValidationError('District not found');
            }
        }

        if (updateStudentDto.school) {
            const school = await School.findById(updateStudentDto.school);
            if (!school) {
                throw new ValidationError('School not found');
            }
        }

        if (updateStudentDto.teacher) {
            const teacher = await Teacher.findById(updateStudentDto.teacher);
            if (!teacher) {
                throw new ValidationError('Teacher not found');
            }
        }

        const updateData: Partial<IStudentInput> = {
            ...(updateStudentDto.firstName && { firstName: updateStudentDto.firstName }),
            ...(updateStudentDto.lastName && { lastName: updateStudentDto.lastName }),
            ...(updateStudentDto.middleName && { middleName: updateStudentDto.middleName }),
            ...(updateStudentDto.code && { code: parseInt(updateStudentDto.code, 10) }),
            ...(updateStudentDto.teacher && { teacher: new Types.ObjectId(updateStudentDto.teacher) }),
            ...(updateStudentDto.school && { school: new Types.ObjectId(updateStudentDto.school) }),
            ...(updateStudentDto.district && { district: new Types.ObjectId(updateStudentDto.district) })
        };

        const updatedStudent = await this.studentRepository.update(id, updateData);
        if (!updatedStudent) {
            throw new NotFoundError('Student not found');
        }

        return updatedStudent;
    }

    async deleteStudent(id: string): Promise<boolean> {
        const student = await this.studentRepository.findById(id);
        if (!student) {
            throw new NotFoundError('Student not found');
        }
        return this.studentRepository.delete(id);
    }

    async deleteStudents(ids: string[]): Promise<boolean> {
        return this.studentRepository.deleteMany({ _id: { $in: ids } });
    }
}