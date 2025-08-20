"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairTeachers = exports.deleteTeachers = exports.deleteTeacher = exports.updateTeacher = exports.createAllTeachers = exports.createTeacher = exports.getTeachersForFilter = exports.getTeachers = void 0;
const teacher_model_1 = __importDefault(require("../models/teacher.model"));
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const mongoose_1 = require("mongoose");
const excel_service_1 = require("../services/excel.service");
const teacher_service_1 = require("../services/teacher.service");
const school_service_1 = require("../services/school.service");
const file_service_1 = require("../services/file.service");
const district_service_1 = require("../services/district.service");
const getTeachers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, totalCount } = yield (0, teacher_service_1.getFiltredTeachers)(req);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta!", error });
    }
});
exports.getTeachers = getTeachers;
const getTeachersForFilter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const schoolIds = req.query.schoolIds
            ? req.query.schoolIds.split(',').map(id => new mongoose_1.Types.ObjectId(id.trim()))
            : [];
        const filter = {};
        if (schoolIds.length > 0) {
            filter.school = { $in: schoolIds };
        }
        const [data, totalCount] = yield Promise.all([
            teacher_model_1.default.find(filter)
                .populate('school')
                .sort({ code: 1 }),
            teacher_model_1.default.countDocuments(filter)
        ]);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta", error });
    }
});
exports.getTeachersForFilter = getTeachersForFilter;
const createTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        const existingTeacher = yield teacher_model_1.default.findOne({ code });
        if (existingTeacher) {
            res.status(400).json({ message: "Bu kodda müəllim artıq mövcuddur" });
            return;
        }
        const teacher = new teacher_model_1.default({
            fullname,
            code,
            district: district._id,
            school: school._id,
            active
        });
        const savedTeacher = yield teacher_model_1.default.create(teacher);
        yield savedTeacher.populate('district school');
        res.status(201).json({ message: 'Müəllim uğurla yaradıldı!', data: savedTeacher });
    }
    catch (error) {
        res.status(500).json({ message: "Müəllimin əlavə edilməsində xəta", error });
    }
});
exports.createTeacher = createTeacher;
const createAllTeachers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            res.status(400).json({ message: "Fayl yüklənməyib!" });
            return;
        }
        const rows = (0, excel_service_1.readExcel)(req.file.path);
        if (rows.length < 5) {
            res.status(400).json({ message: "Faylda kifayət qədər sətr yoxdur!" });
            return;
        }
        // первый столбец он нулевой, нам не нужен
        const dataToInsert = rows.slice(4).map(row => ({
            districtCode: Number(row[1]) || 0, // 2-ой столбец
            schoolCode: Number(row[2]) || 0, // 3-ий столбец
            code: Number(row[3]), // 4-ый столбец
            fullname: String(row[4]) // 5-ый столбец
        }));
        // Выявляем и отсеиваем некорректных учителей
        const correctTeachersToInsert = dataToInsert.filter(data => data.code > 999999);
        const incorrectTeacherCodes = dataToInsert.filter(data => data.code <= 999999).map(data => data.code);
        // Сначала отсеиваем учителей, которые уже есть
        const existingTeacherCodes = yield (0, teacher_service_1.checkExistingTeacherCodes)(correctTeachersToInsert.map(data => data.code));
        const newTeachers = existingTeacherCodes.length > 0
            ? correctTeachersToInsert.filter(data => !existingTeacherCodes.includes(data.code))
            : correctTeachersToInsert;
        const districtCodes = newTeachers.filter(item => item.districtCode > 0).map(item => item.districtCode);
        const schoolCodes = newTeachers.filter(item => item.schoolCode > 0).map(item => item.schoolCode);
        const teacherCodesWithoutSchoolCodes = newTeachers.filter(item => item.schoolCode === 0).map(item => item.code);
        // Проверяем все ли указанные районы и школы существуют у нас в базе
        const existingDistricts = yield (0, district_service_1.checkExistingDistricts)(districtCodes);
        const existingDistrictCodes = existingDistricts.map(d => d.code);
        const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code));
        const existingSchools = yield (0, school_service_1.checkExistingSchools)(schoolCodes);
        const existingSchoolCodes = existingSchools.map(s => s.code);
        const missingSchoolCodes = schoolCodes.filter(code => !existingSchoolCodes.includes(code));
        const schoolMap = existingSchools.reduce((map, school) => {
            map[school.code] = school._id;
            return map;
        }, {});
        const districtMap = existingDistricts.reduce((map, district) => {
            map[district.code] = district._id;
            return map;
        }, {});
        const teachersToSave = newTeachers.filter(item => item.code > 0 &&
            !missingDistrictCodes.includes(item.districtCode) &&
            !missingSchoolCodes.includes(item.schoolCode) &&
            !teacherCodesWithoutSchoolCodes.includes(item.code)).map(item => ({
            district: districtMap[item.districtCode],
            school: schoolMap[item.schoolCode],
            code: item.code,
            fullname: item.fullname,
            active: true
        }));
        // Remove the uploaded file
        (0, file_service_1.deleteFile)(req.file.path);
        if (teachersToSave.length === 0) {
            res.status(201).json({
                message: "Bütün müəllimlər bazada var!",
                missingSchoolCodes,
                teacherCodesWithoutSchoolCodes,
                incorrectTeacherCodes
            });
            return;
        }
        const results = yield teacher_model_1.default.collection.bulkWrite(teachersToSave.map(teacher => ({
            updateOne: {
                filter: { code: teacher.code },
                update: { $set: teacher },
                upsert: true
            }
        })));
        const numCreated = results.upsertedCount;
        const numUpdated = results.modifiedCount;
        res.status(201).json({
            message: "Fayl uğurla yükləndi!",
            details: `Yeni müəllimlər: ${numCreated}\nYenilənən müəllimlər: ${numUpdated}`,
            missingSchoolCodes,
            teacherCodesWithoutSchoolCodes
        });
    }
    catch (error) {
        res.status(500).json({ message: "Müəllimlərin yaradılmasında xəta!", error });
    }
});
exports.createAllTeachers = createAllTeachers;
const updateTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const teacher = req.body;
        // first we check if teacher district and school are valid and changed
        if (teacher.district) {
            const district = yield district_model_1.default.findById(teacher.district);
            if (!district) {
                res.status(400).json({ message: "Bu kodda rayon tapilmadi" });
                return;
            }
        }
        if (teacher.school) {
            const school = yield school_model_1.default.findById(teacher.school);
            if (!school) {
                res.status(400).json({ message: "Bu kodda məktəb tapılmadı" });
                return;
            }
        }
        // check changed fields of teacher
        const existingTeacher = yield teacher_model_1.default.findById(id);
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
            yield existingTeacher.save();
            res.status(200).json(existingTeacher);
            return;
        }
    }
    catch (error) {
        res.status(500).json({ message: "Müəllimin yenilənməsində xəta", error });
    }
});
exports.updateTeacher = updateTeacher;
const deleteTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const teacherId = req.params.id;
        const result = yield (0, teacher_service_1.deleteTeacherById)(teacherId);
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
});
exports.deleteTeacher = deleteTeacher;
const deleteTeachers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { teacherIds } = req.params;
        if (teacherIds.length === 0) {
            res.status(400).json({ message: "Müəllimlər seçilməyib" });
            return;
        }
        const teacherIdsArr = teacherIds.split(",");
        const result = yield (0, teacher_service_1.deleteTeachersByIds)(teacherIdsArr);
        if (result.deletedCount === 0) {
            res.status(404).json({ message: "Silinmək üçün seçilən müəllimlər bazada tapılmadı" });
            return;
        }
        res.status(200).json({ message: `${result.deletedCount} müəllim bazadan silindi!` });
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
});
exports.deleteTeachers = deleteTeachers;
const repairTeachers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Фильтруем учителей с отсутствующими или строковыми district/school
        const teachers = yield teacher_model_1.default.find({
            $or: [
                { district: null },
                { school: null },
                { district: { $type: 'string' } }, // Проверяем, является ли district строкой
                { school: { $type: 'string' } } // Проверяем, является ли school строкой
            ]
        }).populate('district school');
        const teachersWithoutDistrict = [];
        const teachersWithoutSchool = [];
        const repairedTeachers = [];
        const bulkOps = [];
        for (let teacher of teachers) {
            const teacherCode = teacher.code.toString();
            // Валидация: код должен быть 7 символов
            if (teacherCode.length !== 7) {
                continue;
            }
            let isUpdated = false;
            let newDistrictId = null;
            let newSchoolId = null;
            // Проверяем и исправляем district
            if (!teacher.district || typeof teacher.district === 'string') {
                let districtId;
                if (typeof teacher.district === 'string') {
                    // Если district — строка, пытаемся преобразовать в ObjectId
                    if (mongoose_1.Types.ObjectId.isValid(teacher.district)) {
                        districtId = new mongoose_1.Types.ObjectId(teacher.district);
                        const districtExists = yield district_model_1.default.findById(districtId);
                        if (districtExists) {
                            newDistrictId = districtId;
                            isUpdated = true;
                        }
                    }
                }
                // Если district отсутствует или строка некорректна, ищем по коду
                if (!teacher.district) {
                    const districtCode = teacherCode.substring(0, 3);
                    const district = yield district_model_1.default.findOne({ code: districtCode });
                    if (district) {
                        newDistrictId = district._id;
                        isUpdated = true;
                    }
                    else {
                        teachersWithoutDistrict.push(teacherCode);
                    }
                }
            }
            // Проверяем и исправляем school
            if (!teacher.school || typeof teacher.school === 'string') {
                let schoolId;
                if (typeof teacher.school === 'string') {
                    // Если school — строка, пытаемся преобразовать в ObjectId
                    if (mongoose_1.Types.ObjectId.isValid(teacher.school)) {
                        schoolId = new mongoose_1.Types.ObjectId(teacher.school);
                        const schoolExists = yield school_model_1.default.findById(schoolId);
                        if (schoolExists) {
                            newSchoolId = schoolId;
                            isUpdated = true;
                        }
                    }
                }
                // Если school отсутствует или строка некорректна, ищем по коду
                if (!teacher.school) {
                    const schoolCode = teacherCode.substring(0, 5);
                    const school = yield school_model_1.default.findOne({ code: schoolCode });
                    if (school) {
                        newSchoolId = school._id;
                        isUpdated = true;
                    }
                    else {
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
            yield teacher_model_1.default.bulkWrite(bulkOps);
        }
        res.status(200).json({
            message: "Müəllimlərin məlumatları yeniləndi",
            repairedTeachers,
            teachersWithoutDistrict,
            teachersWithoutSchool
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta", error });
    }
});
exports.repairTeachers = repairTeachers;
