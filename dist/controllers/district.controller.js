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
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkExistingDistrictCodes = exports.countDistrictsRates = exports.processDistrictsFromExcel = exports.deleteDistricts = exports.deleteDistrict = exports.updateDistrict = exports.createDistrict = exports.updateDistrictsStats = exports.getDistrictById = exports.getDistrictsForFilter = exports.getDistricts = exports.createAllDistricts = exports.DistrictController = void 0;
const district_usecase_1 = require("../usecases/district.usecase");
const district_service_1 = require("../services/district.service");
const request_parser_util_1 = require("../utils/request-parser.util");
const response_handler_util_1 = require("../utils/response-handler.util");
class DistrictController {
    constructor() {
        this.updateDistrictsStats = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.districtUseCase.updateDistrictsStats();
                res.json(response_handler_util_1.ResponseHandler.success({}, 'District statistics updated successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getDistricts = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const pagination = request_parser_util_1.RequestParser.parsePagination(req);
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const sort = request_parser_util_1.RequestParser.parseSorting(req, 'name', 'asc');
                const result = yield this.districtUseCase.getFilteredDistricts(pagination, filters, sort);
                res.json(response_handler_util_1.ResponseHandler.success({
                    data: result.data,
                    totalCount: result.totalCount
                }, 'Districts retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getDistrictsForFilter = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const filters = request_parser_util_1.RequestParser.parseFilterOptions(req);
                const districts = yield this.districtUseCase.getDistrictsForFilter(filters);
                res.json(response_handler_util_1.ResponseHandler.success(districts, 'Districts for filter retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.getDistrictById = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const district = yield this.districtUseCase.getDistrictById(id);
                res.json(response_handler_util_1.ResponseHandler.success(district, 'District retrieved successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.createDistrict = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const districtData = req.body;
                const district = yield this.districtUseCase.createDistrict(districtData);
                res.status(201).json(response_handler_util_1.ResponseHandler.created(district, 'District created successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.updateDistrict = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                const updateData = req.body;
                const district = yield this.districtUseCase.updateDistrict(id, updateData);
                res.json(response_handler_util_1.ResponseHandler.updated(district, 'District updated successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteDistrict = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = req.params;
                yield this.districtUseCase.deleteDistrict(id);
                res.json(response_handler_util_1.ResponseHandler.deleted('District deleted successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.deleteDistricts = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { ids } = req.body;
                const result = yield this.districtUseCase.deleteDistricts(ids);
                res.json(response_handler_util_1.ResponseHandler.success(result, `${result.deletedCount} district(s) deleted successfully`));
            }
            catch (error) {
                next(error);
            }
        });
        this.processDistrictsFromExcel = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!req.file) {
                    res.status(400).json(response_handler_util_1.ResponseHandler.badRequest('No file uploaded'));
                    return;
                }
                const result = yield this.districtUseCase.processDistrictsFromExcel(req.file.path);
                res.json(response_handler_util_1.ResponseHandler.success(result, `Processed ${result.processedData.length} districts from Excel file`));
            }
            catch (error) {
                next(error);
            }
        });
        this.countDistrictsRates = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.districtUseCase.countDistrictsRates();
                res.json(response_handler_util_1.ResponseHandler.success({}, 'District rates counted successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.checkExistingDistrictCodes = (req, res, next) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { codes } = req.body;
                const existingCodes = yield this.districtUseCase.checkExistingDistrictCodes(codes);
                res.json(response_handler_util_1.ResponseHandler.success(existingCodes, 'District codes checked successfully'));
            }
            catch (error) {
                next(error);
            }
        });
        this.districtUseCase = new district_usecase_1.DistrictUseCase(new district_service_1.DistrictService());
    }
}
exports.DistrictController = DistrictController;
// Legacy exports for backward compatibility
const districtController = new DistrictController();
exports.createAllDistricts = districtController.processDistrictsFromExcel;
exports.getDistricts = districtController.getDistricts;
exports.getDistrictsForFilter = districtController.getDistrictsForFilter;
exports.getDistrictById = districtController.getDistrictById;
exports.updateDistrictsStats = districtController.updateDistrictsStats;
exports.createDistrict = districtController.createDistrict;
exports.updateDistrict = districtController.updateDistrict;
exports.deleteDistrict = districtController.deleteDistrict;
exports.deleteDistricts = districtController.deleteDistricts;
exports.processDistrictsFromExcel = districtController.processDistrictsFromExcel;
exports.countDistrictsRates = districtController.countDistrictsRates;
exports.checkExistingDistrictCodes = districtController.checkExistingDistrictCodes;
