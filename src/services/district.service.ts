import { Request } from 'express';
import { DistrictRepository } from '../repositories/district.repository';
import { IDistrict } from '../models/district.model';
import { CreateDistrictDto, UpdateDistrictDto } from '../dtos/district.dto';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors';
import District from '../models/district.model';
import Student from '../models/student.model';
import StudentResult from '../models/studentResult.model';
import School from '../models/school.model';
import Teacher from '../models/teacher.model';

export class DistrictService {
    constructor(private readonly districtRepository: DistrictRepository) {}

    async getDistricts(req: Request): Promise<{ data: IDistrict[]; totalCount: number }> {
        const districts = await this.districtRepository.find(req.query);
        return { data: districts, totalCount: districts.length };
    }

    async getDistrict(id: string): Promise<IDistrict> {
        const district = await this.districtRepository.findById(id);
        if (!district) {
            throw new NotFoundError('District not found');
        }
        return district;
    }

    async createDistrict(createDistrictDto: CreateDistrictDto): Promise<IDistrict> {
        // Check if district already exists
        const existingDistrict = await this.districtRepository.findByName(createDistrictDto.name);
        if (existingDistrict) {
            throw new ConflictError('District with this name already exists');
        }

        return this.districtRepository.create(createDistrictDto);
    }

    async updateDistrict(id: string, updateDistrictDto: UpdateDistrictDto): Promise<IDistrict> {
        const district = await this.districtRepository.findById(id);
        if (!district) {
            throw new NotFoundError('District not found');
        }

        const updatedDistrict = await this.districtRepository.update(id, updateDistrictDto);
        if (!updatedDistrict) {
            throw new NotFoundError('District not found');
        }

        return updatedDistrict;
    }

    async deleteDistrict(id: string): Promise<boolean> {
        const district = await this.districtRepository.findById(id);
        if (!district) {
            throw new NotFoundError('District not found');
        }
        return this.districtRepository.delete(id);
    }

    async deleteDistricts(ids: string[]): Promise<boolean> {
        return this.districtRepository.deleteMany({ _id: { $in: ids } });
    }
}

export const checkExistingDistrict = async (district: IDistrict): Promise<boolean> => {
    try {
        const foundedDistrict = await District.find({ code: district.code });
        return foundedDistrict.length > 0;
    } catch (error) {
        console.error(error);
        return true;
    }
}

export const checkExistingDistricts = async (codes: number[]): Promise<IDistrict[]> => {
    try {
        console.log("🔍 Поиск районов по кодам...");
        const result = await District.find({ code: { $in: codes } });
        return result;
    } catch (error) {
        console.error(error);
        throw new Error("Не удалось осуществить поиск!");
    }
}

export const checkExistingDistrictCodes = async (codes: number[]): Promise<number[]> => {
    try {
        // Используем .distinct() для получения массива уникальных кодов
        const existingCodes = await District.distinct("code", { code: { $in: codes } });
        return existingCodes;
    } catch (error) {
        console.error("Ошибка при поиске:", error);
        throw new Error("Не удалось осуществить поиск!");
    }
};

export const countDistrictsRates = async (): Promise<void> => {
    try {
        console.log("🔄 Подсчёт коэффициентов районов...");

        const studentResults = await StudentResult.find().populate("student exam");

        const districtCounts = new Map<string, number>();
        const examDistrictIds = new Set<string>();
        for (const result of studentResults) {
            const districtId = result.student.district?.toString();
            const examId = result.exam?.toString();
            // Проверяем пару район-экзамен, если такой пары нет, то добавляем в мапу +1
            if (districtId && examId) {
                const examDistrictId = `${examId}-${districtId}`;
                if (!examDistrictIds.has(examDistrictId)) {
                    examDistrictIds.add(examDistrictId);
                    districtCounts.set(districtId, (districtCounts.get(districtId) || 0) + 1);
                }
            }
        }

        const bulkUpdates = Array.from(districtCounts.entries()).map(([districtId, rate]) => ({
            updateOne: {
                filter: { _id: districtId },
                update: { rate },
            },
        }));

        if (bulkUpdates.length > 0) {
            await District.bulkWrite(bulkUpdates);
        }

        console.log("✅ Коэффициенты районов подсчитаны!");
    } catch (error) {
        console.error(error);
        throw new Error("Не удалось подсчитать рейтинги!");
    }
}

export const deleteDistrictById = async (id: string) => {
    try {
        // последовательно удаляем сначала студентов, потом учителей, потом школы, а потом уже сам район
        const students = await Student.find({ district: id });
        const studentIds = students.map(student => student._id);
        await StudentResult.deleteMany({ student: { $in: studentIds } });
        await Student.deleteMany({ district: id });
        await School.deleteMany({ district: id });
        await Teacher.deleteMany({ district: id });
        await District.findByIdAndDelete(id);
    } catch (error) {
        throw error;
    }
}