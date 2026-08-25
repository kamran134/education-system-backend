import * as fs from "fs";
import { TeacherServicePg, Teacher, TeacherCreate } from "../services/teacher.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult, FileProcessingResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { CODE_LENGTHS, CODE_DIVISORS } from "../utils/entity-codes.const";
import { profileChangeRequestServicePg } from "../services/profileChangeRequest.service.pg";

export class TeacherUseCase {
    constructor(private teacherService: TeacherServicePg) {}

    async updateTeachersStats(): Promise<void> {
        await this.teacherService.updateTeachersStats();
    }

    async getTeachers(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<PaginatedResponse<Teacher>> {
        const { data, totalCount } = await this.teacherService.getFilteredTeachers(pagination, filters, sort);

        return {
            data,
            totalCount,
            page: pagination.page,
            size: pagination.size,
            totalPages: Math.ceil(totalCount / pagination.size)
        };
    }

    async getTeacherById(id: string): Promise<Teacher> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const teacher = await this.teacherService.findById(parseInt(id, 10));
        if (!teacher) {
            throw new Error('Teacher not found');
        }

        return teacher;
    }

    async createTeacher(teacherData: TeacherCreate): Promise<Teacher> {
        const validation = this.validateTeacherData(teacherData);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingTeacher = await this.teacherService.findByCode(teacherData.code);
        if (existingTeacher) {
            throw new Error('Teacher with this code already exists');
        }

        return await this.teacherService.create(teacherData);
    }

    async updateTeacher(id: string, updateData: Partial<TeacherCreate>, changedByUserId: number): Promise<{ teacher: Teacher; cascadedStudentsCount: number }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingTeacher = await this.teacherService.findById(parseInt(id, 10));
        if (!existingTeacher) {
            throw new Error('Teacher not found');
        }

        if (updateData.code && updateData.code !== existingTeacher.code) {
            // Длина проверяется здесь (а не только при create): начиная с этого каскада, кривая
            // по длине правка кода портит и коды всех учеников этого учителя, не только его самого.
            const lengthError = ValidationUtils.validateCode(updateData.code, CODE_LENGTHS.TEACHER, CODE_LENGTHS.TEACHER);
            if (lengthError) {
                throw new Error(lengthError);
            }

            // Kod yalnız məktəb daxilində fərdi hissədən ibarət ola bilər: məktəb prefiksini
            // (kodun ilk 5 rəqəmi) əl ilə dəyişmək olmaz — bu, müəllimi başqa məktəbə "yamamaq"
            // demək olardı, kod vasitəsilə, FK-ni (schoolId) dəyişmədən. Məktəbi dəyişmək üçün
            // ayrıca schoolId seçilməlidir, kodun məktəb hissəsi ondan REPAIR yolu ilə yenilənir.
            if (existingTeacher.school) {
                const submittedSchoolCode = Math.floor(updateData.code / CODE_DIVISORS.TEACHER_TO_SCHOOL);
                if (submittedSchoolCode !== existingTeacher.school.code) {
                    throw new Error(
                        `Kodun məktəb hissəsini dəyişmək olmaz (${existingTeacher.school.code} olmalıdır). ` +
                        `Yalnız fərdi hissəni (son 2 rəqəmi) dəyişin, ya da müəllimi başqa məktəbə keçirmək üçün Məktəb sahəsini dəyişin.`
                    );
                }
            }

            const codeExists = await this.teacherService.findByCode(updateData.code);
            if (codeExists) {
                throw new Error('Teacher with this code already exists');
            }
        }

        return await this.teacherService.update(parseInt(id, 10), updateData, changedByUserId);
    }

    /** Та же проверка, что внутри updateTeacherProfile — отдельно, чтобы владелец получал
     *  внятную ошибку уже при отправке в модерацию (BASE_FIXES_TASK.md §2.5). */
    validateProfilePayload(data: { gradeLabel?: string | null; pedagogicalExperienceYears?: number | null; achievements?: string | null }): string | null {
        const validation = ValidationUtils.combine([
            data.pedagogicalExperienceYears != null
                ? ValidationUtils.validateNumber(data.pedagogicalExperienceYears, 'Pedaqoji staj', 0, 70)
                : null,
            data.gradeLabel != null && data.gradeLabel.length > 40
                ? 'Sinif 40 simvoldan uzun ola bilməz'
                : null,
        ]);
        return validation.isValid ? null : validation.errors.join(', ');
    }

    /**
     * Самостоятельное редактирование профиля (biography/pedagogicalExperienceYears/achievements)
     * — PROFILES_TASK.md §2.3, стаж переведён на число лет в BASE_FIXES_TASK.md §2.3/§2.5 (сюда
     * попадает только через модерацию — см. profileChangeRequest.service.pg.ts approve()).
     * Не проходит через полный updateTeacher: не трогает code, поэтому changedByUserId нужен
     * только на случай сигнатуры teacherService.update, каскад кода не запускается (codeChanging
     * всегда false для этого набора полей).
     */
    async updateTeacherProfile(id: string, data: { biography?: string | null; pedagogicalExperienceYears?: number | null; achievements?: string | null; gradeLabel?: string | null }, changedByUserId: number): Promise<{ teacher: Teacher; cascadedStudentsCount: number }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID'),
            data.pedagogicalExperienceYears != null
                ? ValidationUtils.validateNumber(data.pedagogicalExperienceYears, 'Pedaqoji staj', 0, 70)
                : null,
            data.gradeLabel != null && data.gradeLabel.length > 40
                ? 'Sinif 40 simvoldan uzun ola bilməz'
                : null,
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        // Пустая строка -> null (PROFILES_V3_TASK.md §5.1) — тримим здесь, а не полагаемся
        // на CHECK-ограничение колонки, чтобы " " не долетала до БД как "заполненное" значение.
        const normalized = {
            ...data,
            gradeLabel: data.gradeLabel !== undefined ? (data.gradeLabel?.trim() || null) : undefined,
        };

        return await this.teacherService.update(parseInt(id, 10), normalized, changedByUserId);
    }

    async deleteTeacher(id: string): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const teacher = await this.teacherService.findById(parseInt(id, 10));
        if (!teacher) {
            throw new Error('Teacher not found');
        }

        await this.teacherService.delete(parseInt(id, 10));
        await profileChangeRequestServicePg.deleteForEntity('teacher', parseInt(id, 10));
    }

    async deleteTeachers(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'Teacher IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        const numericIds = ids.map((id) => parseInt(id, 10));
        const result = await this.teacherService.deleteBulk(numericIds);
        await profileChangeRequestServicePg.deleteForEntities('teacher', numericIds);
        return result;
    }

    async processTeachersFromFile(filePath: string): Promise<FileProcessingResult<Teacher>> {
        if (!filePath) {
            throw new Error('File path is required');
        }

        return await this.teacherService.processTeachersFromExcel(filePath);
    }

    async repairTeachers(): Promise<{
        repairedTeachers: number[],
        failedTeachers: Array<{ code: number, reason: string }>,
        missedDistricts: number[],
        missedSchools: number[]
    }> {
        return await this.teacherService.repairTeacherAssignments();
    }

    async getTeachersForFilter(filters: FilterOptionsPg): Promise<Teacher[]> {
        return await this.teacherService.getTeachersForFilter(filters);
    }

    async importLegacyTeachers(filePath: string): Promise<{
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

        return await this.teacherService.importLegacyTeachers(records);
    }

    private validateTeacherData(data: TeacherCreate): ValidationResult {
        return ValidationUtils.combine([
            ValidationUtils.validateRequired(data.fullname, 'Full name'),
            ValidationUtils.validateRequired(data.code, 'Teacher code'),
            ValidationUtils.validateCode(data.code, CODE_LENGTHS.TEACHER, CODE_LENGTHS.TEACHER)
        ]);
    }
}
