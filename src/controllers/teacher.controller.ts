import { Request, Response, NextFunction } from 'express';
import Teacher, { ITeacher, ITeacherInput } from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import { Types } from "mongoose";
import { readExcel } from "../services/excel.service";
import { checkExistingTeacherCodes, deleteTeacherById, deleteTeachersByIds, getFiltredTeachers } from "../services/teacher.service";
import { checkExistingSchools } from "../services/school.service";
import { deleteFile } from "../services/file.service";
import { checkExistingDistricts } from "../services/district.service";
import { TeacherService } from '../services/teacher.service';
import { TeacherRepository } from '../repositories/teacher.repository';
import { CreateTeacherDto, UpdateTeacherDto } from '../dtos/teacher.dto';
import { validateDto } from '../middleware/validation.middleware';
import { AppError } from '../utils/errors';

const teacherRepository = new TeacherRepository(Teacher);
const teacherService = new TeacherService(teacherRepository);

export const getTeachers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await teacherService.getTeachers(req);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

export const getTeachersForFilter = async (req: Request, res: Response) => {
    try {
        const schoolIds: Types.ObjectId[] = req.query.schoolIds
            ? (req.query.schoolIds as string).split(',').map(id => new Types.ObjectId(id.trim()))
            : [];
        
        const filter: any = {};

        if (schoolIds.length > 0) {
            filter.school = { $in: schoolIds };
        }

        const [data, totalCount] = await Promise.all([
            Teacher.find(filter)
                .populate('school')
                .sort({ code: 1 }),
            Teacher.countDocuments(filter)
        ]);

        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta", error });
    }
};

export const createTeacher = [
    validateDto(CreateTeacherDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const teacher = await teacherService.createTeacher(req.body);
            res.status(201).json(teacher);
        } catch (error) {
            next(error);
        }
    }
];

export const createAllTeachers = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ message: "Fayl yüklənməyib!" });
            return;
        }

        const rows: any[] = readExcel(req.file.path);

        if (rows.length < 5) {
            res.status(400).json({ message: "Faylda kifayət qədər sətr yoxdur!" });
            return;
        }

        // первый столбец он нулевой, нам не нужен

        const dataToInsert: ITeacherInput[] = rows.slice(4).map(row => ({
            districtCode: Number(row[1]) || 0, // 2-ой столбец
            schoolCode: Number(row[2]) || 0, // 3-ий столбец
            code: Number(row[3]), // 4-ый столбец
            fullname: String(row[4]) // 5-ый столбец
        }));

        // Выявляем и отсеиваем некорректных учителей
        const correctTeachersToInsert = dataToInsert.filter(data => data.code > 999999);
        const incorrectTeacherCodes = dataToInsert.filter(data => data.code <= 999999).map(data => data.code);

        // Сначала отсеиваем учителей, которые уже есть
        const existingTeacherCodes: number[] = await checkExistingTeacherCodes(correctTeachersToInsert.map(data => data.code));
        
        const newTeachers: ITeacherInput[] = existingTeacherCodes.length > 0
            ? correctTeachersToInsert.filter(data => !existingTeacherCodes.includes(data.code))
            : correctTeachersToInsert;

        const districtCodes = newTeachers.filter(item => item.districtCode > 0).map(item => item.districtCode);
        const schoolCodes = newTeachers.filter(item => item.schoolCode > 0).map(item => item.schoolCode);
        const teacherCodesWithoutSchoolCodes = newTeachers.filter(item => item.schoolCode === 0).map(item => item.code);
        
        // Проверяем все ли указанные районы и школы существуют у нас в базе
        const existingDistricts = await checkExistingDistricts(districtCodes);
        const existingDistrictCodes = existingDistricts.map(d => d.code);
        const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code));

        const existingSchools = await checkExistingSchools(schoolCodes);
        const existingSchoolCodes = existingSchools.map(s => s.code);
        const missingSchoolCodes = schoolCodes.filter(code => !existingSchoolCodes.includes(code));

        const schoolMap = existingSchools.reduce((map, school) => {
            map[school.code] = school._id as Types.ObjectId;
            return map;
        }, {} as Record<string, Types.ObjectId>);

        const districtMap = existingDistricts.reduce((map, district) => {
            map[district.code] = district._id as Types.ObjectId;
            return map;
        }, {} as Record<string, Types.ObjectId>);

        const teachersToSave = newTeachers.filter(
            item =>
                item.code > 0 &&
                !missingDistrictCodes.includes(item.districtCode) &&
                !missingSchoolCodes.includes(item.schoolCode) &&
                !teacherCodesWithoutSchoolCodes.includes(item.code)
            ).map(
                item => ({
                    district: districtMap[item.districtCode],
                    school: schoolMap[item.schoolCode],
                    code: item.code,
                    fullname: item.fullname,
                    active: true
        }));

        // Remove the uploaded file
        deleteFile(req.file.path);

        if (teachersToSave.length === 0) {
            res.status(201).json({
                message: "Bütün müəllimlər bazada var!",
                missingSchoolCodes,
                teacherCodesWithoutSchoolCodes,
                incorrectTeacherCodes
            });
            return;
        }

        const results = await Teacher.collection.bulkWrite(
            teachersToSave.map(teacher => ({
                updateOne: {
                    filter: { code: teacher.code }, 
                    update: { $set: teacher }, 
                    upsert: true 
                }
            }))
        );

        const numCreated = results.upsertedCount;
        const numUpdated = results.modifiedCount;

        res.status(201).json({
            message: "Fayl uğurla yükləndi!",
            details: `Yeni müəllimlər: ${numCreated}\nYenilənən müəllimlər: ${numUpdated}`,
            missingSchoolCodes,
            teacherCodesWithoutSchoolCodes
        });
    } catch (error) {
        res.status(500).json({ message: "Müəllimlərin yaradılmasında xəta!", error });
    }
}

export const updateTeacher = [
    validateDto(UpdateTeacherDto),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const teacher = await teacherService.updateTeacher(req.params.id, req.body);
            res.status(200).json(teacher);
        } catch (error) {
            next(error);
        }
    }
];

export const deleteTeacher = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const success = await teacherService.deleteTeacher(req.params.id);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'Teacher not found');
        }
    } catch (error) {
        next(error);
    }
};

export const deleteTeachers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            throw new AppError(400, 'Invalid request body. Expected an array of teacher IDs.');
        }
        const success = await teacherService.deleteTeachers(ids);
        if (success) {
            res.status(204).send();
        } else {
            throw new AppError(404, 'No teachers found to delete');
        }
    } catch (error) {
        next(error);
    }
};

export const repairTeachers = async (req: Request, res: Response) => {
    try {
        // Фильтруем учителей с отсутствующими или строковыми district/school
        const teachers = await Teacher.find({
            $or: [
                { district: null },
                { school: null },
                { district: { $type: 'string' } }, // Проверяем, является ли district строкой
                { school: { $type: 'string' } }    // Проверяем, является ли school строкой
            ]
        }).populate('district school');

        const teachersWithoutDistrict: string[] = [];
        const teachersWithoutSchool: string[] = [];
        const repairedTeachers: string[] = [];
        const bulkOps: any[] = [];

        for (let teacher of teachers) {
            const teacherCode: string = teacher.code.toString();

            // Валидация: код должен быть 7 символов
            if (teacherCode.length !== 7) {
                continue;
            }

            let isUpdated = false;
            let newDistrictId: Types.ObjectId | null = null;
            let newSchoolId: Types.ObjectId | null = null;

            // Проверяем и исправляем district
            if (!teacher.district || typeof teacher.district === 'string') {
                let districtId;
                if (typeof teacher.district === 'string') {
                    // Если district — строка, пытаемся преобразовать в ObjectId
                    if (Types.ObjectId.isValid(teacher.district)) {
                        districtId = new Types.ObjectId(teacher.district);
                        const districtExists = await District.findById(districtId);
                        if (districtExists) {
                            newDistrictId = districtId;
                            isUpdated = true;
                        }
                    }
                }

                // Если district отсутствует или строка некорректна, ищем по коду
                if (!teacher.district) {
                    const districtCode = teacherCode.substring(0, 3);
                    const district = await District.findOne({ code: districtCode });
                    if (district) {
                        newDistrictId = district._id as Types.ObjectId;
                        isUpdated = true;
                    } else {
                        teachersWithoutDistrict.push(teacherCode);
                    }
                }
            }

            // Проверяем и исправляем school
            if (!teacher.school || typeof teacher.school === 'string') {
                let schoolId;
                if (typeof teacher.school === 'string') {
                    // Если school — строка, пытаемся преобразовать в ObjectId
                    if (Types.ObjectId.isValid(teacher.school)) {
                        schoolId = new Types.ObjectId(teacher.school);
                        const schoolExists = await School.findById(schoolId);
                        if (schoolExists) {
                            newSchoolId = schoolId;
                            isUpdated = true;
                        }
                    }
                }

                // Если school отсутствует или строка некорректна, ищем по коду
                if (!teacher.school) {
                    const schoolCode = teacherCode.substring(0, 5);
                    const school = await School.findOne({ code: schoolCode });
                    if (school) {
                        newSchoolId = school._id as Types.ObjectId;
                        isUpdated = true;
                    } else {
                        teachersWithoutSchool.push(teacherCode);
                    }
                }
            }

            // Если были изменения, добавляем в bulkOps
            if (isUpdated) {
                bulkOps.push({
                    updateOne: {
                        filter: { _id: teacher._id },
                        update: { $set: { district: newDistrictId, school: newSchoolId } }
                    }
                });
                repairedTeachers.push(teacherCode);
            }
        }

        // Выполняем пакетное обновление
        if (bulkOps.length > 0) {
            await Teacher.bulkWrite(bulkOps);
        }

        res.status(200).json({
            message: "Müəllimlərin məlumatları yeniləndi",
            repairedTeachers,
            teachersWithoutDistrict,
            teachersWithoutSchool
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta", error });
    }
};