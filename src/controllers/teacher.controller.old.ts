import { Request, Response } from "express";
import Teacher, { ITeacher, ITeacherInput } from "../models/teacher.model";
import School from "../models/school.model";
import District from "../models/district.model";
import { Types } from "mongoose";
import { readExcel } from "../services/excel.service";
import { checkExistingTeacherCodes, deleteTeacherById, deleteTeachersByIds, getFiltredTeachers } from "../services/teacher.service";
import { checkExistingSchools } from "../services/school.service";
import { deleteFile } from "../services/file.service";
import { checkExistingDistricts } from "../services/district.service";

export const getTeachers = async (req: Request, res: Response) => {
    try {
        const { data, totalCount } = await getFiltredTeachers(req);
        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta!", error });
    }
}

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

export const createTeacher = async (req: Request, res: Response) => {
    try {
        const { fullname, code, district, school, active } = req.body;

        if (!fullname || !code) {
            res.status(400).json({ message: "Məlumatlar tam deyil" });
            return;
        }

        if (code.toString().length !== 7) {
            res.status(400).json({ message: "Müəllim kodu 7 simvoldan ibarət olmalıdır" });
            return;
        }

        const existingTeacher = await Teacher.findOne({ code });
        if (existingTeacher) {
            res.status(400).json({ message: "Bu kodda müəllim artıq mövcuddur" });
            return;
        }

        const teacher = new Teacher({
            fullname,
            code,
            district: district._id,
            school: school._id,
            active
        });

        const savedTeacher = await Teacher.create(teacher);
        await savedTeacher.populate('district school');
        res.status(201).json({message: 'Müəllim uğurla yaradıldı!', data: savedTeacher});
    } catch (error) {
        res.status(500).json({ message: "Müəllimin əlavə edilməsində xəta", error })
    }
}

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

export const updateTeacher = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const teacher: ITeacher = req.body as ITeacher;
        
        // first we check if teacher district and school are valid and changed
        if (teacher.district) {
            const district = await District.findById(teacher.district);
            if (!district) {
                res.status(400).json({ message: "Bu kodda rayon tapilmadi" });
                return;
            }
        }

        if (teacher.school) {
            const school = await School.findById(teacher.school);
            if (!school) {
                res.status(400).json({ message: "Bu kodda məktəb tapılmadı" });
                return;
            }
        }

        // check changed fields of teacher
        const existingTeacher = await Teacher.findById(id);
        if (!existingTeacher) {
            res.status(404).json({ message: "Müəllim tapılmadı" });
            return;
        }

        let isUpdated = false;
        if (existingTeacher.district !== teacher.district) {
            existingTeacher.district = teacher.district;
            isUpdated = true;
        }

        if (existingTeacher.school !== teacher.school) {
            existingTeacher.school = teacher.school;
            isUpdated = true;
        }

        if (existingTeacher.code !== teacher.code) {
            existingTeacher.code = teacher.code;
            isUpdated = true;
        }

        if (existingTeacher.fullname !== teacher.fullname) {
            existingTeacher.fullname = teacher.fullname;
            isUpdated = true;
        }

        if (existingTeacher.active !== teacher.active) {
            existingTeacher.active = teacher.active;
            isUpdated = true;
        }

        if (isUpdated) {
            await existingTeacher.save();
            res.status(200).json(existingTeacher);
            return;
        }
    } catch (error) {
        res.status(500).json({ message: "Müəllimin yenilənməsində xəta", error });
    }
}

export const deleteTeacher = async (req: Request, res: Response) => {
    try {
        const teacherId = req.params.id;
        const result = await deleteTeacherById(teacherId);
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
}

export const deleteTeachers = async (req: Request, res: Response) => {
    try {
        const { teacherIds } = req.params;
        if (teacherIds.length === 0) {
            res.status(400).json({ message: "Müəllimlər seçilməyib" });
            return;
        }
        const teacherIdsArr = teacherIds.split(",");

        const result = await deleteTeachersByIds(teacherIdsArr);
        
        if (result.deletedCount === 0) {
            res.status(404).json({ message: "Silinmək üçün seçilən müəllimlər bazada tapılmadı" });
            return;
        }

        res.status(200).json({ message: `${result.deletedCount} müəllim bazadan silindi!` });
    } catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
}

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