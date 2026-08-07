import * as fs from "fs";
import { StudentServicePg, Student, StudentCreate, StudentResultRow } from "../services/student.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { CODE_LENGTHS, CODE_DIVISORS } from "../utils/entity-codes.const";

export class StudentUseCase {
    constructor(private studentService: StudentServicePg) {}

    async getStudents(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<PaginatedResponse<Student>> {
        const { data, totalCount } = await this.studentService.getFilteredStudents(pagination, filters, sort);

        return {
            data,
            totalCount,
            page: pagination.page,
            size: pagination.size,
            totalPages: Math.ceil(totalCount / pagination.size)
        };
    }

    async getStudentById(id: string): Promise<Student & { results: StudentResultRow[] }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateId(id, 'Student ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const student = await this.studentService.findById(parseInt(id, 10));
        if (!student) {
            throw new Error('Student not found');
        }

        const results = await this.studentService.getResultsByStudentId(student.id);

        return { ...student, results };
    }

    async createStudent(studentData: StudentCreate): Promise<Student> {
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

    async updateStudent(id: string, updateData: Partial<StudentCreate>): Promise<Student> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateId(id, 'Student ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingStudent = await this.studentService.findById(parseInt(id, 10));
        if (!existingStudent) {
            throw new Error('Student not found');
        }

        if (updateData.code && updateData.code !== existingStudent.code) {
            // Uzunluq yalnız create-də deyil, edit-də də yoxlanılmalıdır (teacher/school ilə eyni səbəb).
            const lengthError = ValidationUtils.validateCode(updateData.code, CODE_LENGTHS.STUDENT, CODE_LENGTHS.STUDENT);
            if (lengthError) {
                throw new Error(lengthError);
            }

            // Kod yalnız müəllim daxilində fərdi hissədən ibarət ola bilər: müəllim prefiksini
            // (kodun ilk 7 rəqəmi) əl ilə dəyişmək olmaz — şagirdi başqa müəllimə keçirmək üçün
            // ayrıca Müəllim sahəsi seçilməlidir (teacher.usecase.ts/school.usecase.ts ilə eyni qayda).
            if (existingStudent.teacher) {
                const submittedTeacherCode = Math.floor(updateData.code / CODE_DIVISORS.STUDENT_TO_TEACHER);
                if (submittedTeacherCode !== existingStudent.teacher.code) {
                    throw new Error(
                        `Kodun müəllim hissəsini dəyişmək olmaz (${existingStudent.teacher.code} olmalıdır). ` +
                        `Yalnız fərdi hissəni (son 3 rəqəmi) dəyişin, ya da şagirdi başqa müəllimə keçirmək üçün Müəllim sahəsini dəyişin.`
                    );
                }
            }

            const codeExists = await this.studentService.findByCode(updateData.code);
            if (codeExists) {
                throw new Error('Student with this code already exists');
            }
        }

        return await this.studentService.update(parseInt(id, 10), updateData);
    }

    async deleteStudent(id: string): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateId(id, 'Student ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const student = await this.studentService.findById(parseInt(id, 10));
        if (!student) {
            throw new Error('Student not found');
        }

        // Каскад в student.service.pg.ts уже удаляет student_results одной транзакцией.
        await this.studentService.delete(parseInt(id, 10));
    }

    async deleteStudents(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'Student IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        return await this.studentService.deleteBulk(ids.map((id) => parseInt(id, 10)));
    }

    async searchStudents(searchString: string): Promise<Student[]> {
        if (!searchString || searchString.trim().length < 2) {
            throw new Error('Search string must be at least 2 characters long');
        }

        return await this.studentService.search(searchString.trim());
    }

    async repairStudents(): Promise<{
        repairedStudents: number[],
        failedStudents: Array<{ code: number, reason: string }>,
        missedDistricts: number[],
        missedSchools: number[],
        missedTeachers: number[]
    }> {
        return await this.studentService.repairStudentAssignments();
    }

    async importLegacyStudents(filePath: string): Promise<{
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
        details: { skippedCodes: number[]; errorMessages: string[] };
    }> {
        if (!filePath) {
            throw new Error('File path is required');
        }

        let rawContent: string;
        try {
            rawContent = fs.readFileSync(filePath, 'utf-8').trim();
        } catch (err: any) {
            throw new Error(`Failed to read file: ${err.message}`);
        } finally {
            try { fs.unlinkSync(filePath); } catch {}
        }

        let records: any[];
        if (rawContent.startsWith('[')) {
            records = JSON.parse(rawContent);
        } else {
            records = rawContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => JSON.parse(line));
        }

        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('File must contain a non-empty array or newline-delimited JSON records');
        }

        return await this.studentService.importLegacyStudents(records);
    }

    private validateStudentData(data: StudentCreate): ValidationResult {
        return ValidationUtils.combine([
            ValidationUtils.validateRequired(data.firstName, 'First name'),
            ValidationUtils.validateRequired(data.lastName, 'Last name'),
            ValidationUtils.validateRequired(data.code, 'Student code'),
            ValidationUtils.validateCode(data.code, CODE_LENGTHS.STUDENT, CODE_LENGTHS.STUDENT),
            ValidationUtils.validateNumber(data.grade, 'Grade', 1, 12)
        ]);
    }
}
