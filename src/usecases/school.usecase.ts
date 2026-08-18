import * as fs from "fs";
import { SchoolServicePg, School, SchoolCreate } from "../services/school.service.pg";
import { pg } from "../config/pg";
import { PaginationOptions, FilterOptionsPg, SortOptions, PaginatedResponse, BulkOperationResult, ValidationResult, FileProcessingResult } from "../types/common.types";
import { ValidationUtils } from "../utils/validation.util";
import { CODE_LENGTHS, CODE_DIVISORS } from "../utils/entity-codes.const";

export class SchoolUseCase {
    constructor(private schoolService: SchoolServicePg) {}

    async updateSchoolsStats(): Promise<void> {
        await this.schoolService.updateSchoolsStats();
    }

    async getSchools(
        pagination: PaginationOptions,
        filters: FilterOptionsPg,
        sort: SortOptions
    ): Promise<PaginatedResponse<School>> {
        const { data, totalCount } = await this.schoolService.getFilteredSchools(pagination, filters, sort);

        return {
            data,
            totalCount,
            page: pagination.page,
            size: pagination.size,
            totalPages: Math.ceil(totalCount / pagination.size)
        };
    }

    async getSchoolById(id: string): Promise<School> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateId(id, 'School ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const school = await this.schoolService.findById(parseInt(id, 10));
        if (!school) {
            throw new Error('School not found');
        }

        return school;
    }

    async createSchool(schoolData: any): Promise<School> {
        // If district is an object (from frontend), extract id/code
        if (schoolData.district && typeof schoolData.district === 'object') {
            schoolData.districtId = schoolData.district.id;
        }
        // If districtCode is provided but not districtId, resolve by code
        else if (schoolData.districtCode && !schoolData.districtId) {
            const district = await pg.selectFrom("districts").select("id").where("code", "=", schoolData.districtCode).executeTakeFirst();
            if (!district) {
                throw new Error(`District with code ${schoolData.districtCode} not found`);
            }
            schoolData.districtId = district.id;
        }

        const validation = this.validateSchoolData(schoolData);
        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingSchool = await this.schoolService.findByCode(schoolData.code);
        if (existingSchool) {
            throw new Error('School with this code already exists');
        }

        return await this.schoolService.create(schoolData);
    }

    async updateSchool(id: string, updateData: any, changedByUserId: number): Promise<{ school: School; cascadedTeachersCount: number; cascadedStudentsCount: number }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateId(id, 'School ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const existingSchool = await this.schoolService.findById(parseInt(id, 10));
        if (!existingSchool) {
            throw new Error('School not found');
        }

        if (updateData.district && typeof updateData.district === 'object') {
            updateData.districtId = updateData.district.id;
        } else if (updateData.districtCode && !updateData.districtId) {
            const district = await pg.selectFrom("districts").select("id").where("code", "=", updateData.districtCode).executeTakeFirst();
            if (!district) {
                throw new Error(`District with code ${updateData.districtCode} not found`);
            }
            updateData.districtId = district.id;
        }

        if (updateData.code && updateData.code !== existingSchool.code) {
            // Длина проверяется здесь (а не только при create): начиная с этого каскада, кривая
            // по длине правка кода портит коды и её учителей, и учеников этих учителей.
            const lengthError = ValidationUtils.validateCode(updateData.code, CODE_LENGTHS.SCHOOL, CODE_LENGTHS.SCHOOL);
            if (lengthError) {
                throw new Error(lengthError);
            }

            // Kod yalnız rayon daxilində fərdi hissədən ibarət ola bilər: rayon prefiksini (kodun
            // ilk 3 rəqəmi) əl ilə dəyişmək olmaz — məktəbi başqa rayona keçirmək üçün ayrıca
            // District sahəsi seçilməlidir, kodun rayon hissəsi ondan asılı deyil.
            if (existingSchool.district) {
                const submittedDistrictCode = Math.floor(updateData.code / CODE_DIVISORS.SCHOOL_TO_DISTRICT);
                if (submittedDistrictCode !== existingSchool.district.code) {
                    throw new Error(
                        `Kodun rayon hissəsini dəyişmək olmaz (${existingSchool.district.code} olmalıdır). ` +
                        `Yalnız fərdi hissəni (son 2 rəqəmi) dəyişin, ya da məktəbi başqa rayona keçirmək üçün District sahəsini dəyişin.`
                    );
                }
            }

            const codeExists = await this.schoolService.findByCode(updateData.code);
            if (codeExists) {
                throw new Error('School with this code already exists');
            }
        }

        return await this.schoolService.update(parseInt(id, 10), updateData, changedByUserId);
    }

    /**
     * Самостоятельное редактирование профиля (description/history/directorName/foundedYear/
     * achievements) — PROFILES_TASK.md §2.3. Не проходит через полный updateSchool: не трогает
     * code, каскад кода не запускается.
     */
    async updateSchoolProfile(id: string, data: { description?: string | null; history?: string | null; directorName?: string | null; foundedYear?: number | null; achievements?: string | null }, changedByUserId: number): Promise<{ school: School; cascadedTeachersCount: number; cascadedStudentsCount: number }> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateId(id, 'School ID'),
            data.foundedYear != null
                ? ValidationUtils.validateNumber(data.foundedYear, 'Məktəbin yaranma tarixi', 1800, new Date().getFullYear())
                : null,
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        return await this.schoolService.update(parseInt(id, 10), data, changedByUserId);
    }

    async deleteSchool(id: string): Promise<void> {
        const validation = ValidationUtils.combine([
            ValidationUtils.validateRequired(id, 'School ID'),
            ValidationUtils.validateId(id, 'School ID')
        ]);

        if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
        }

        const school = await this.schoolService.findById(parseInt(id, 10));
        if (!school) {
            throw new Error('School not found');
        }

        await this.schoolService.delete(parseInt(id, 10));
    }

    async deleteSchools(ids: string[]): Promise<BulkOperationResult> {
        const arrayValidation = ValidationUtils.validateArray(ids, 'School IDs', 1);
        if (!arrayValidation.isValid) {
            throw new Error(arrayValidation.errors.join(', '));
        }

        return await this.schoolService.deleteBulk(ids.map((id) => parseInt(id, 10)));
    }

    async processSchoolsFromFile(filePath: string): Promise<FileProcessingResult<School>> {
        if (!filePath) {
            throw new Error('File path is required');
        }

        return await this.schoolService.processSchoolsFromExcel(filePath);
    }

    async getSchoolsForFilter(filters: FilterOptionsPg): Promise<School[]> {
        return await this.schoolService.getSchoolsForFilter(filters);
    }

    async importLegacySchools(filePath: string): Promise<{
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

        return await this.schoolService.importLegacySchools(records);
    }

    private validateSchoolData(data: SchoolCreate): ValidationResult {
        return ValidationUtils.combine([
            ValidationUtils.validateRequired(data.name, 'School name'),
            ValidationUtils.validateRequired(data.code, 'School code'),
            ValidationUtils.validateCode(data.code, CODE_LENGTHS.SCHOOL, CODE_LENGTHS.SCHOOL)
        ]);
    }
}
