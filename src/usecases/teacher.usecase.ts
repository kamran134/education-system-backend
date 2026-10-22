import * as fs from "fs";
import { TeacherServicePg, Teacher, TeacherCreate } from "../services/teacher.service.pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult, FileProcessingResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { CODE_LENGTHS, CODE_DIVISORS } from "../utils/entity-codes.const";
import { pg } from "../config/pg";
import { assertCodeNotDeleted } from "../services/deletion.service.pg";

function fail(status: number, message: string): never {
    throw Object.assign(new Error(message), { status });
}

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
            throw Object.assign(new Error('Teacher not found'), { status: 404 });
        }

        return teacher;
    }

    async createTeacher(teacherData: TeacherCreate): Promise<Teacher> {
        // KICIK_DUZELISLER_2026-09-11 п.4a: фронт может прислать school/district вложенными
        // объектами (как и у школ, см. school.usecase.ts createSchool) — без нормализации в
        // schoolId/districtId эти поля в теле отсутствовали, и новый учитель создавался
        // без привязки к школе/району.
        if ((teacherData as any).school && typeof (teacherData as any).school === 'object') {
            teacherData.schoolId = (teacherData as any).school.id;
        }
        if ((teacherData as any).district && typeof (teacherData as any).district === 'object') {
            teacherData.districtId = (teacherData as any).district.id;
        }

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
            throw Object.assign(new Error('Teacher not found'), { status: 404 });
        }

        // KICIK_DUZELISLER_2026-09-11 п.4a: та же нормализация, что и в createTeacher выше —
        // фронт шлёт весь Teacher целиком со вложенными school/district, а не плоскими id.
        // Без этого schoolId/districtId из тела не читались, и смена школы молча не сохранялась
        // (buildTeacherSet в teacher.service.pg.ts кладёт в апдейт только то, что реально пришло).
        if ((updateData as any).school && typeof (updateData as any).school === 'object') {
            updateData.schoolId = (updateData as any).school.id;
        }
        if ((updateData as any).district && typeof (updateData as any).district === 'object') {
            updateData.districtId = (updateData as any).district.id;
        }

        // A different school is no longer an edit (TRANSFERS_TASK.md §4.2): moving a teacher is the separate
        // transfer operation, where the students stay behind and the points stay with the old school.
        if (updateData.schoolId !== undefined && updateData.schoolId !== (existingTeacher.school?.id ?? null)) {
            throw Object.assign(
                new Error('Məktəbi dəyişmək üçün «Başqa məktəbə köçür» əməliyyatından istifadə edin'),
                { status: 400 }
            );
        }
        // The code of the school the teacher's code must still belong to. undefined if he has no school at all.
        const targetSchoolCode: number | undefined = existingTeacher.school?.code;

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
            // ayrıca «Başqa məktəbə köçür» əməliyyatı (transferTeacher) istifadə olunur.
            if (targetSchoolCode !== undefined) {
                const submittedSchoolCode = Math.floor(updateData.code / CODE_DIVISORS.TEACHER_TO_SCHOOL);
                if (submittedSchoolCode !== targetSchoolCode) {
                    throw new Error(
                        // YENI_DUZELISLER_2026-09-17 п.3: "müəllimi" (вин. падеж, самостоятельное
                        // упоминание сущности) → "layihə müəllimini".
                        `Kodun məktəb hissəsini dəyişmək olmaz (${targetSchoolCode} olmalıdır). ` +
                        `Yalnız fərdi hissəni (son 2 rəqəmi) dəyişin, ya da layihə müəllimini başqa məktəbə keçirmək üçün «Başqa məktəbə köçür» əməliyyatından istifadə edin.`
                    );
                }
            }

            const codeExists = await this.teacherService.findByCode(updateData.code);
            if (codeExists) {
                // KICIK_DUZELISLER_2026-09-11 п.4a: azərbaycanca mətn — yalnız bu budaqda
                // (create-də mətn dəyişdirilmir).
                // YENI_DUZELISLER_2026-09-17 п.3: "müəllimdə" (местн. падеж) → "layihə müəllimində".
                throw new Error('Bu kod artıq başqa layihə müəllimində istifadə olunur');
            }
        }

        return await this.teacherService.update(parseInt(id, 10), updateData, changedByUserId);
    }

    /**
     * Moves a teacher to another school (TRANSFERS_TASK.md §4): the students stay in the old school with another
     * teacher, past results stay where they were earned. All validation lives here, the writes in
     * TeacherServicePg.transfer (one transaction).
     */
    async transferTeacher(
        id: string,
        body: { schoolId?: unknown; codeSuffix?: unknown; studentsToTeacherId?: unknown },
        changedByUserId: number
    ): Promise<{ teacher: Teacher; movedStudents: Array<{ id: number; fullname: string; oldCode: number; newCode: number }> }> {
        const idError = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID')
        ]);
        if (!idError.isValid) fail(400, idError.errors.join(', '));
        const teacherId = parseInt(id, 10);

        const teacher = await pg.selectFrom("teachers").select(["id", "code", "school_id"]).where("id", "=", teacherId).executeTakeFirst();
        if (!teacher) fail(404, 'Teacher not found');

        const schoolId = Number(body.schoolId);
        if (!Number.isInteger(schoolId) || schoolId <= 0) fail(400, 'Məktəb seçilməyib');
        const school = await pg.selectFrom("schools").select(["id", "code"]).where("id", "=", schoolId).executeTakeFirst();
        if (!school) fail(400, 'Məktəb tapılmadı');
        if (school.id === teacher.school_id) fail(400, 'Müəllim artıq bu məktəbdədir');

        const suffix = body.codeSuffix === undefined || body.codeSuffix === null
            ? teacher.code % CODE_DIVISORS.TEACHER_TO_SCHOOL
            : Number(body.codeSuffix);
        if (!Number.isInteger(suffix) || suffix < 1 || suffix >= CODE_DIVISORS.TEACHER_TO_SCHOOL) {
            fail(400, 'Kodun fərdi hissəsi 1 ilə 99 arasında olmalıdır');
        }
        const newCode = school.code * CODE_DIVISORS.TEACHER_TO_SCHOOL + suffix;
        const lengthError = ValidationUtils.validateCode(newCode, CODE_LENGTHS.TEACHER, CODE_LENGTHS.TEACHER);
        if (lengthError) fail(400, lengthError);

        // A hidden teacher keeps his code too (UNIQUE lives on the base table), hence teachers_all.
        await assertCodeNotDeleted("teacher", newCode);
        const codeOwner = await pg.selectFrom("teachers_all").select("id").where("code", "=", newCode).executeTakeFirst();
        if (codeOwner) fail(409, 'Bu kod artıq başqa layihə müəllimində istifadə olunur');

        // All students pointing to him, hidden ones included: a restored student must not keep a teacher of a foreign school.
        const studentCountRow = await pg.selectFrom("students_all")
            .select((eb) => eb.fn.countAll<string>().as("count"))
            .where("teacher_id", "=", teacherId)
            .executeTakeFirstOrThrow();
        let studentsToTeacherId: number | null = null;
        if (Number(studentCountRow.count) > 0) {
            if (body.studentsToTeacherId === undefined || body.studentsToTeacherId === null || body.studentsToTeacherId === '') {
                fail(400, 'Şagirdləri hansı müəllimə verəcəyinizi seçin');
            }
            const targetId = Number(body.studentsToTeacherId);
            if (!Number.isInteger(targetId) || targetId <= 0) fail(400, 'Şagirdləri hansı müəllimə verəcəyinizi seçin');
            if (targetId === teacherId) fail(400, 'Şagirdlər müəllimin özünə verilə bilməz');
            const target = await pg.selectFrom("teachers").select(["id", "school_id"]).where("id", "=", targetId).executeTakeFirst();
            if (!target) fail(400, 'Şagirdlərin veriləcəyi müəllim tapılmadı');
            // The students stay in the OLD school of the moving teacher.
            if (teacher.school_id === null || target.school_id !== teacher.school_id) {
                fail(400, 'Şagirdlər yalnız müəllimin köhnə məktəbindəki başqa müəllimə verilə bilər');
            }
            studentsToTeacherId = targetId;
        }

        return await this.teacherService.transfer(teacherId, { schoolId, newCode, studentsToTeacherId }, changedByUserId);
    }

    /** Та же проверка, что внутри updateTeacherProfile — отдельно, чтобы владелец получал
     *  внятную ошибку уже при отправке в модерацию (BASE_FIXES_TASK.md §2.5). */
    validateProfilePayload(data: { fullname?: string | null; gradeLabel?: string | null; pedagogicalExperienceYears?: number | null; achievements?: string | null }): string | null {
        const validation = ValidationUtils.combine([
            data.fullname !== undefined ? ValidationUtils.validateRequired(data.fullname, 'Ad Soyad') : null,
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
    async updateTeacherProfile(id: string, data: { fullname?: string; biography?: string | null; pedagogicalExperienceYears?: number | null; achievements?: string | null; gradeLabel?: string | null }, changedByUserId: number): Promise<{ teacher: Teacher; cascadedStudentsCount: number }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID'),
            data.fullname !== undefined ? ValidationUtils.validateRequired(data.fullname, 'Ad Soyad') : null,
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

    async deleteTeacher(id: string, deletedBy: number | null = null): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'Teacher ID'),
            ValidationUtils.validateId(id, 'Teacher ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const teacher = await this.teacherService.findById(parseInt(id, 10));
        if (!teacher) {
            throw Object.assign(new Error('Teacher not found'), { status: 404 });
        }

        // Soft delete: moderation requests and achievement files (rows and files on disk) stay untouched,
        // they come back with the teacher.
        await this.teacherService.delete(parseInt(id, 10), deletedBy);
    }

    async deleteTeachers(ids: string[], deletedBy: number | null = null): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'Teacher IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        const numericIds = ids.map((id) => parseInt(id, 10));
        return await this.teacherService.deleteBulk(numericIds, deletedBy);
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
