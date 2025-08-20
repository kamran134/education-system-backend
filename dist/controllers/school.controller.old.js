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
exports.repairSchools = exports.deleteSchools = exports.deleteSchool = exports.updateSchool = exports.createAllSchools = exports.createSchool = exports.getSchoolsForFilter = exports.getSchools = void 0;
const school_model_1 = __importDefault(require("../models/school.model"));
const district_model_1 = __importDefault(require("../models/district.model"));
const mongoose_1 = __importDefault(require("mongoose"));
const file_service_1 = require("../services/file.service");
const school_service_1 = require("../services/school.service");
const district_service_1 = require("../services/district.service");
const excel_service_1 = require("../services/excel.service");
const getSchools = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { data, totalCount } = yield (0, school_service_1.getFiltredSchools)(req);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "Məktəblərin alınmasında xəta", error });
    }
});
exports.getSchools = getSchools;
const getSchoolsForFilter = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const districtIds = req.query.districtIds
            ? req.query.districtIds.split(',').map(id => new mongoose_1.default.Types.ObjectId(id.trim()))
            : [];
        const filter = {};
        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }
        console.log(filter);
        const [data, totalCount] = yield Promise.all([
            school_model_1.default.find(filter)
                .sort({ name: 1 }),
            school_model_1.default.countDocuments(filter)
        ]);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "Məktəblərin alınmasında xəta", error });
    }
});
exports.getSchoolsForFilter = getSchoolsForFilter;
const createSchool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, address, code, district, active } = req.body;
        if (!name || !code || !district) {
            res.status(400).json({ message: "Məlumatlar tam deyil" });
            return;
        }
        if (code.toString().length !== 5) {
            res.status(400).json({ message: "Məktəb kodu 5 simvoldan ibarət olmalıdır" });
            return;
        }
        const existingDistrict = yield district_model_1.default.findOne({ code: district.code });
        if (!existingDistrict) {
            res.status(400).json({ message: "Bu kodda rayon tapılmadı" });
            return;
        }
        const school = new school_model_1.default({
            name,
            address,
            code,
            districtCode: existingDistrict.code,
            district: existingDistrict._id,
            active
        });
        // Check if school with the same code already exists
        const existingSchool = yield school_model_1.default.findOne({ code });
        if (existingSchool) {
            res.status(400).json({ message: "Bu kodda məktəb artıq mövcuddur" });
            return;
        }
        // const savedSchool = await school.save();
        // create a new school and return with populated district
        const savedSchool = yield school_model_1.default.create(school);
        yield savedSchool.populate('district', 'name code');
        res.status(201).json({ message: "Məktəb uğurla yaradıldı! ", data: savedSchool });
    }
    catch (error) {
        res.status(500).json({ message: "Məktəbin yaradılmasında xəta", error });
    }
});
exports.createSchool = createSchool;
const createAllSchools = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            res.status(400).json({ message: "Fayl yüklənməyib!" });
            return;
        }
        const rows = (0, excel_service_1.readExcel)(req.file.path);
        if (rows.length < 5) {
            console.warn('Not enough rows');
            res.status(400).json({ message: "Faylda kifayət qədər sətr yoxdur!" });
            return;
        }
        // прочли и присвоили модели
        const dataToInsert = rows.slice(4).map(row => ({
            districtCode: Number(row[1]) || 0,
            code: Number(row[2]),
            name: String(row[3]),
            address: ''
        }));
        // Выявляем и отсеиваем некорректных учителей
        const correctSchoolsToInsert = dataToInsert.filter(data => data.code > 9999);
        const incorrectSchoolCodes = dataToInsert.filter(data => data.code <= 9999).map(data => data.code);
        // Сначала отсеиваем школы, которые уже есть
        const existingSchoolCodes = yield (0, school_service_1.checkExistingSchoolCodes)(correctSchoolsToInsert.map(data => data.code));
        const newSchools = existingSchoolCodes.length > 0 ?
            correctSchoolsToInsert.filter(data => !existingSchoolCodes.includes(data.code))
            : correctSchoolsToInsert;
        // Отделяем те строки, где не был указан код района, их выведем в конце на фронт
        const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
        const schoolCodesWithoutDistrictCodes = newSchools.filter(item => item.districtCode === 0).map(item => item.code);
        // Проверяем все ли указанные районы существуют у нас в базе
        const existingDistricts = yield (0, district_service_1.checkExistingDistricts)(districtCodes);
        const existingDistrictCodes = existingDistricts.map(d => d.code);
        const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code));
        const districtMap = existingDistricts.reduce((map, district) => {
            map[district.code] = district._id;
            return map;
        }, {});
        const schoolsToSave = newSchools.filter(item => item.code > 0 &&
            !missingDistrictCodes.includes(item.districtCode) &&
            !schoolCodesWithoutDistrictCodes.includes(item.code)).map(item => ({
            name: item.name,
            address: item.address,
            code: item.code,
            districtCode: item.districtCode,
            district: districtMap[item.districtCode],
            active: true
        }));
        // Remove the uploaded file
        (0, file_service_1.deleteFile)(req.file.path);
        if (schoolsToSave.length === 0) {
            res.status(201).json({
                message: "Bütün məktəblər bazada var!",
                missingDistrictCodes,
                schoolCodesWithoutDistrictCodes,
                incorrectSchoolCodes
            });
            return;
        }
        const results = yield school_model_1.default.collection.bulkWrite(schoolsToSave.map(school => ({
            updateOne: {
                filter: { code: school.code },
                update: { $set: school },
                upsert: true
            }
        })));
        // Analyze results for success and failures
        const numCreated = results.upsertedCount;
        const numUpdated = results.modifiedCount;
        res.status(201).json({
            message: "Fayl uğurla yükləndi!",
            details: `Yeni məktəblər: ${numCreated}\nYenilənən məktəblər: ${numUpdated}`,
            missingDistrictCodes,
            schoolCodesWithoutDistrictCodes
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Məktəblərin yaradılmasında xəta", error });
    }
});
exports.createAllSchools = createAllSchools;
const updateSchool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const school = req.body;
        // first we check if teacher district and school are valid and changed
        if (school.district) {
            const district = yield district_model_1.default.findById(school.district);
            if (!district) {
                res.status(400).json({ message: "Bu kodda rayon tapilmadi" });
                return;
            }
        }
        // check changed fields of teacher
        const existingSchool = yield school_model_1.default.findById(id);
        if (!existingSchool) {
            res.status(404).json({ message: "Məktəb tapılmadı" });
            return;
        }
        let isUpdated = false;
        if (existingSchool.district !== school.district) {
            existingSchool.district = school.district;
            isUpdated = true;
        }
        if (existingSchool.name !== school.name) {
            existingSchool.name = school.name;
            isUpdated = true;
        }
        if (existingSchool.address !== school.address) {
            existingSchool.address = school.address;
            isUpdated = true;
        }
        if (existingSchool.code !== school.code) {
            existingSchool.code = school.code;
            isUpdated = true;
        }
        if (existingSchool.active !== school.active) {
            existingSchool.active = school.active;
            isUpdated = true;
        }
        if (isUpdated) {
            yield existingSchool.save();
            res.status(200).json(existingSchool);
            return;
        }
    }
    catch (error) {
        res.status(500).json({ message: "Məktəbin yenilənməsində xəta", error });
    }
});
exports.updateSchool = updateSchool;
const deleteSchool = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const schoolId = req.params.id;
        const result = yield (0, school_service_1.deleteSchoolById)(schoolId);
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
});
exports.deleteSchool = deleteSchool;
const deleteSchools = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { schoolIds } = req.params;
        if (schoolIds.length === 0) {
            res.status(400).json({ message: "Məktəblər seçilməyib" });
            return;
        }
        const schoolIdsArr = schoolIds.split(",");
        const result = yield (0, school_service_1.deleteSchoolsByIds)(schoolIdsArr);
        if (result.deletedCount === 0) {
            res.status(404).json({ message: "Silinmək üçün seçilən məktəblər bazada tapılmadı" });
            return;
        }
        res.status(200).json({ message: `${result.deletedCount} məktəb bazadan silindi!` });
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
});
exports.deleteSchools = deleteSchools;
const repairSchools = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const schools = yield school_model_1.default.find().populate('district');
        const schoolsWithoutDistrict = [];
        const repairedSchools = [];
        for (let school of schools) {
            const schoolCode = school.code.toString();
            if (schoolCode.length !== 5)
                continue;
            let isUpdated = false;
            if (!school.district) {
                const districtCode = schoolCode.substring(0, 3);
                const district = yield district_model_1.default.findOne({ code: districtCode });
                if (district) {
                    school.district = district;
                    isUpdated = true;
                }
                else {
                    schoolsWithoutDistrict.push(school.code.toString());
                }
            }
            if (isUpdated) {
                yield school.save();
                repairedSchools.push(school.code.toString());
            }
        }
        res.status(200).json({
            message: "Məktəblərin məlumatları yeniləndi",
            repairedSchools,
            schoolsWithoutDistrict,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta", error });
    }
});
exports.repairSchools = repairSchools;
