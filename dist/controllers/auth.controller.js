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
exports.logout = exports.checkRole = exports.approveUser = exports.register = exports.login = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_validator_1 = require("express-validator");
const user_model_1 = __importDefault(require("../models/user.model"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const login = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, password } = req.body;
    try {
        const user = yield user_model_1.default.findOne({ email });
        console.log("Found user:", user);
        if (!user || !(yield bcrypt_1.default.compare(password, user.passwordHash))) {
            res.status(400).json({ message: "Yanlış məlumatlar!" });
            return;
        }
        if (!(user === null || user === void 0 ? void 0 : user.isApproved)) {
            res.status(403).json({ message: "Adminin təsdiqi mütləqdir!" });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: "48h" });
        res.cookie("token", token, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
            path: "/"
        });
        res.json({ message: "Uğurlu avtorizasiya", token });
    }
    catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
});
exports.login = login;
const register = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { email, password, role } = req.body;
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    try {
        const existingUser = yield user_model_1.default.findOne({ email });
        if (existingUser) {
            res.status(400).json({ message: "İstifadəçi artıq mövcuddur!" });
            return;
        }
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        if (!password || typeof password !== "string" || password.trim().length < 6) {
            res.status(400).json({ message: "Parol təqdim edilməyib və ya düzgün formatda deyil!" });
            return;
        }
        const passwordHash = yield bcrypt_1.default.hash(password.toString(), 10);
        const newUser = new user_model_1.default({
            email, passwordHash, role: role || 'user', isApproved: role === "superadmin"
        });
        yield newUser.save();
        res.status(201).json({ message: "İstifadəçi qeydiyyatdan keçdi. Təsdiq gözlənilir." });
    }
    catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
});
exports.register = register;
const approveUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const user = yield user_model_1.default.findByIdAndUpdate(id, { isApproved: true }, { new: true });
        if (!user) {
            res.status(404).json({ message: "İstifadəçi tapılmadı!" });
            return;
        }
        res.json({ message: "İstifadəçi təsdiq edildi!", user });
    }
    catch (error) {
        res.status(500).json({ message: "Serverdə xəta!" });
        console.error(error);
    }
});
exports.approveUser = approveUser;
const checkRole = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.params.id;
    console.log("Checking role for user ID:", userId);
    if (!userId) {
        res.status(401).json({ message: "İstifadəçi tapılmadı!" });
        return;
    }
    const role = yield user_model_1.default.findById(userId).select("role");
    if (!role) {
        res.status(404).json({ message: "İstifadəçi rolu tapılmadı!" });
        return;
    }
    res.json({ role: role.role });
});
exports.checkRole = checkRole;
const logout = (req, res) => {
    res.clearCookie("token").json({ message: "Sistemdən çıxdınız" });
};
exports.logout = logout;
