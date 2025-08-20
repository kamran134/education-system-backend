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
exports.deleteDistrict = exports.createAllDistricts = exports.createDistrict = exports.getDistricts = void 0;
const district_model_1 = __importDefault(require("../models/district.model"));
const district_service_1 = require("../services/district.service");
const getDistricts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const sortColumn = ((_a = req.query.sortColumn) === null || _a === void 0 ? void 0 : _a.toString()) || 'averageScore';
        const sortDirection = ((_b = req.query.sortDirection) === null || _b === void 0 ? void 0 : _b.toString()) || 'desc';
        const code = req.query.code ? parseInt(req.query.code) : 0;
        const filter = {};
        if (code) {
            const codeString = code.toString().padEnd(3, '0');
            const codeStringEnd = code.toString().padEnd(3, '9');
            filter.code = { $gte: codeString, $lte: codeStringEnd };
        }
        const [data, totalCount] = yield Promise.all([
            district_model_1.default.find(filter).sort({ [sortColumn]: sortDirection === 'asc' ? 1 : -1 }),
            district_model_1.default.countDocuments()
        ]);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "Rayonların alınmasında xəta", error });
    }
});
exports.getDistricts = getDistricts;
const createDistrict = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, region, code } = req.body;
        const district = new district_model_1.default({ name, region, code });
        const checkDistrictToExist = yield (0, district_service_1.checkExistingDistrict)(district);
        if (!checkDistrictToExist) {
            const savedDistrict = yield district.save();
            res.status(201).json({ savedDistrict, message: 'Rayon uğurla əlavə edildi' });
        }
        else {
            res.status(409).json({ message: 'Rayon artıq bazada var' });
        }
    }
    catch (error) {
        res.status(500).json({ message: "Rayonun yaradılmasında xəta!", error });
    }
});
exports.createDistrict = createDistrict;
const createAllDistricts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const reqBody = req.body;
        if (!Array.isArray(reqBody)) {
            res.status(400).json({ message: "Verilənlər massiv deyil!" });
        }
        else {
            // Используем insertMany для массовой вставки
            const savedDistricts = yield district_model_1.default.insertMany(reqBody);
            // Отправляем ответ с массивом сохранённых объектов
            res.status(201).json(savedDistricts);
        }
    }
    catch (error) {
        res.status(500).json({ message: "Rayonların yaradılmasında xəta", error });
    }
});
exports.createAllDistricts = createAllDistricts;
const deleteDistrict = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield district_model_1.default.findByIdAndDelete(req.params.id);
        if (!result) {
            res.status(404).json({ message: "Rayon tapılmadı" });
        }
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
    }
});
exports.deleteDistrict = deleteDistrict;
