import District, { IDistrict } from "../models/district.model";
import Student from "../models/student.model";
import StudentResult from "../models/studentResult.model";
import School from "../models/school.model";
import Teacher from "../models/teacher.model";

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