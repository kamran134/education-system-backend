import { IStudent, IStudentInput } from "../models/student.model";
import { IStudentResult } from "../models/studentResult.model";
import { StudentService } from "../services/student.service";
import { StudentResultService } from "../services/studentResult.service";
import { PaginationOptions, FilterOptions, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { Types } from "mongoose";

export class StudentUseCase {
    constructor(
        private studentService: StudentService,
        private studentResultService: StudentResultService
    ) {}

    async getStudents(
        pagination: PaginationOptions,
        filters: FilterOptions,
        sort: SortOptions
    ): Promise<PaginatedResponse<IStudent>> {
        const { data, totalCount } = await this.studentService.getFilteredStudents(
            pagination,
            filters,
            sort
        );

        return {
            data,
            totalCount,
            page: pagination.page,
            size: pagination.size,
            totalPages: Math.ceil(totalCount / pagination.size)
        };
    }

    async getStudentById(id: string): Promise<IStudent & { results: IStudentResult[] }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateObjectId(id, 'Student ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const student = await this.studentService.findById(id);
        if (!student) {
            throw new Error('Student not found');
        }

        const studentResults = await this.studentResultService.getResultsByStudentId(student._id as Types.ObjectId);

        return {
            ...student.toObject(),
            results: studentResults
        };
    }

    async createStudent(studentData: IStudentInput): Promise<IStudent> {
        const validation = this.validateStudentData(studentData);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingStudent = await this.studentService.findByCode(studentData.code);
        if (existingStudent) {
            throw new Error('Student with this code already exists');
        }

        return await this.studentService.create(studentData);
    }

    async updateStudent(id: string, updateData: Partial<IStudentInput>): Promise<IStudent> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateObjectId(id, 'Student ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingStudent = await this.studentService.findById(id);
        if (!existingStudent) {
            throw new Error('Student not found');
        }

        if (updateData.code && updateData.code !== existingStudent.code) {
            const codeExists = await this.studentService.findByCode(updateData.code);
            if (codeExists) {
                throw new Error('Student with this code already exists');
            }
        }

        return await this.studentService.update(id, updateData);
    }

    async deleteStudent(id: string): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateObjectId(id, 'Student ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const student = await this.studentService.findById(id);
        if (!student) {
            throw new Error('Student not found');
        }

        // Delete associated results first
        await this.studentResultService.deleteByStudentId(new Types.ObjectId(id));
        
        // Then delete the student
        await this.studentService.delete(id);
    }

    async deleteStudents(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'Student IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        const objectIds = ids.map(id => new Types.ObjectId(id));
        
        // Delete associated results first
        await this.studentResultService.deleteBulkByStudentIds(objectIds);
        
        // Then delete students
        return await this.studentService.deleteBulk(objectIds);
    }

    async searchStudents(searchString: string): Promise<IStudent[]> {
        if (!searchString || searchString.trim().length < 2) {
            throw new Error('Search string must be at least 2 characters long');
        }

        return await this.studentService.search(searchString.trim());
    }

    async repairStudents(): Promise<{ repairedStudents: number[], studentsWithoutTeacher: number[] }> {
        return await this.studentService.repairStudentAssignments();
    }

    private validateStudentData(data: IStudentInput): ValidationResult {
        return ValidationUtils.combine([
            ValidationUtils.validateRequired(data.firstName, 'First name'),
            ValidationUtils.validateRequired(data.lastName, 'Last name'),
            ValidationUtils.validateRequired(data.code, 'Student code'),
            ValidationUtils.validateCode(data.code, 10, 10),
            ValidationUtils.validateNumber(data.grade, 'Grade', 1, 12)
        ]);
    }
}
