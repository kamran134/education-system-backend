import * as fs from "fs";
import { StudentServicePg, Student, StudentCreate, StudentResultRow } from "../services/student.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { CODE_LENGTHS, CODE_DIVISORS, rebaseCode } from "../utils/entity-codes.const";
import { profileChangeRequestServicePg } from "../services/profileChangeRequest.service.pg";
import { pg } from "../config/pg";

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

        // DUZELISLER_2026-09-29 п.2: фронт (как в teacher.usecase.ts/school.usecase.ts) может
        // прислать teacher/school/district вложенными объектами вместо плоских id — без этой
        // нормализации выбор другого учителя в диалоге молча не сохранялся бы, т.к.
        // studentService.update() читает только плоские *Id-поля. schoolId/districtId с клиента
        // не принимаются вовсе — у ученика они всегда выводятся из учителя (см. ниже).
        const anyUpdateData = updateData as any;
        if (anyUpdateData.teacher && typeof anyUpdateData.teacher === 'object') {
            updateData.teacherId = anyUpdateData.teacher.id;
        }
        // Сравнение ниже строгое (!==) — строковый id с клиента дал бы ложный «перевод» к тому же
        // учителю, и код молча перебазировался бы обратно на старый префикс.
        if (updateData.teacherId != null) updateData.teacherId = Number(updateData.teacherId);
        if (anyUpdateData.school && typeof anyUpdateData.school === 'object') {
            updateData.schoolId = anyUpdateData.school.id;
        }
        if (anyUpdateData.district && typeof anyUpdateData.district === 'object') {
            updateData.districtId = anyUpdateData.district.id;
        }
        delete updateData.schoolId;
        delete updateData.districtId;

        const currentTeacherId = existingStudent.teacher?.id ?? null;
        let code = updateData.code ?? existingStudent.code;

        if (updateData.code && updateData.code !== existingStudent.code) {
            // Uzunluq yalnız create-də deyil, edit-də də yoxlanılmalıdır (teacher/school ilə eyni səbəb).
            const lengthError = ValidationUtils.validateCode(updateData.code, CODE_LENGTHS.STUDENT, CODE_LENGTHS.STUDENT);
            if (lengthError) {
                throw new Error(lengthError);
            }
        }

        // DUZELISLER_2026-09-29 п.2: старый запрет "Kodun müəllim hissəsini dəyişmək olmaz" убран
        // целиком. Требование заказчика: если поменяли префикс кода на код другого учителя,
        // ученик автоматически переводится к НЕМУ — отдельно менять поле «Layihə müəllimi» не
        // обязательно, достаточно поправить код.
        if (updateData.teacherId != null && updateData.teacherId !== currentTeacherId) {
            // Перевод через явно выбранное в диалоге поле «Layihə müəllimi».
            const teacher = await pg.selectFrom("teachers").select(["id", "code", "school_id", "district_id"]).where("id", "=", updateData.teacherId).executeTakeFirst();
            if (!teacher) {
                throw new Error('Layihə müəllimi tapılmadı');
            }
            if (Math.floor(code / CODE_DIVISORS.STUDENT_TO_TEACHER) !== teacher.code) {
                code = rebaseCode(code, teacher.code, CODE_DIVISORS.STUDENT_TO_TEACHER);
            }
            updateData.teacherId = teacher.id;
            updateData.schoolId = teacher.school_id;
            updateData.districtId = teacher.district_id;
            updateData.code = code;
        } else if (
            Math.floor(code / CODE_DIVISORS.STUDENT_TO_TEACHER) !== existingStudent.teacher?.code
            // Ученик без учителя и с нетронутым кодом (правят только ФИО/класс) — не переводим и не падаем.
            && (existingStudent.teacher || code !== existingStudent.code)
        ) {
            // Перевод по коду: поле «Layihə müəllimi» не трогали, но префикс кода указывает на
            // другого учителя — ищем его по коду (заказчик: 1152301034 → перевод к 1152301).
            const prefix = Math.floor(code / CODE_DIVISORS.STUDENT_TO_TEACHER);
            const teacher = await pg.selectFrom("teachers").select(["id", "code", "school_id", "district_id"]).where("code", "=", prefix).executeTakeFirst();
            if (!teacher) {
                throw new Error(`${prefix} kodlu layihə müəllimi tapılmadı`);
            }
            updateData.teacherId = teacher.id;
            updateData.schoolId = teacher.school_id;
            updateData.districtId = teacher.district_id;
            updateData.code = code;
        } else {
            // Перевода нет — учитель тот же, что и был.
            delete updateData.teacherId;
        }

        if (code !== existingStudent.code) {
            const codeExists = await this.studentService.findByCode(code);
            if (codeExists && codeExists.id !== existingStudent.id) {
                throw new Error('Bu kod artıq başqa şagirddə istifadə olunur');
            }
        }

        return await this.studentService.update(parseInt(id, 10), updateData);
    }

    /** Та же проверка, что внутри updateStudentProfile — отдельно, чтобы учитель получал внятную
     *  ошибку уже при отправке заявки в модерацию (п.3 ТЗ 04.09.2026), а не только когда админ
     *  попытается её подтвердить. */
    validateProfilePayload(data: { fullname?: string }): string | null {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(data.fullname, 'Şagirdin adı, soyadı'),
        ]);
        return validation.isValid ? null : validation.errors.join(', ');
    }

    /**
     * Самостоятельное редактирование ФИО ученика учителем (п.3 ТЗ 04.09.2026), через модерацию —
     * не полный updateStudent: принимает ТОЛЬКО fullname, никакие другие поля (code/teacherId/
     * school/grade и т.д.) сюда не долетают ни при подаче заявки, ни при подтверждении
     * (см. approve() в profileChange.controller.ts — payload там может прийти из body
     * admin-запроса «Düzəliş et», и лишние ключи должны молча игнорироваться).
     */
    async updateStudentProfile(id: string, data: { fullname?: string }): Promise<Student> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Student ID'),
            ValidationUtils.validateId(id, 'Student ID'),
            ValidationUtils.validateRequired(data.fullname, 'Şagirdin adı, soyadı'),
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.studentService.updateProfile(parseInt(id, 10), { fullname: data.fullname! });
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
        // Полиморфная связь без FK (как у school/teacher/district, profileChangeRequest.service.pg.ts)
        // — заявку за удалённого ученика подчищаем явно, иначе она осиротеет в очереди модерации.
        await profileChangeRequestServicePg.deleteForEntity('student', parseInt(id, 10));
    }

    async deleteStudents(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'Student IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        const numericIds = ids.map((id) => parseInt(id, 10));
        const result = await this.studentService.deleteBulk(numericIds);
        await profileChangeRequestServicePg.deleteForEntities('student', numericIds);
        return result;
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
            ValidationUtils.validateRequired(data.fullname, 'Full name'),
            ValidationUtils.validateRequired(data.code, 'Student code'),
            ValidationUtils.validateCode(data.code, CODE_LENGTHS.STUDENT, CODE_LENGTHS.STUDENT),
            ValidationUtils.validateNumber(data.grade, 'Grade', 1, 12)
        ]);
    }
}
