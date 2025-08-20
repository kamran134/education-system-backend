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
exports.createBooklet = exports.getBooklets = void 0;
const booklet_model_1 = __importDefault(require("../models/booklet.model"));
const getBooklets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 10;
        const skip = (page - 1) * size;
        const [data, totalCount] = yield Promise.all([
            booklet_model_1.default.find()
                .skip(skip)
                .limit(size),
            booklet_model_1.default.countDocuments()
        ]);
        res.status(200).json({ data, totalCount });
    }
    catch (error) {
        res.status(500).json({ message: "Kitabçaların alınmasında xəta!", error });
    }
});
exports.getBooklets = getBooklets;
const createBooklet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, date } = req.body;
        const existingBooklet = yield booklet_model_1.default.findOne({ name, date });
        if (existingBooklet) {
            res.status(400).json({ message: "Bu kitabça artıq daxil edilib!" });
            return;
        }
        const booklet = new booklet_model_1.default({
            name,
            date
        });
        const savedBooklet = yield booklet.save();
        res.status(201).json(savedBooklet);
    }
    catch (error) {
        res.status(500).json({ message: "Kitabçanın əlavə edilməsində xəta!", error });
    }
});
exports.createBooklet = createBooklet;
