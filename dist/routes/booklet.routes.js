"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const booklet_controller_1 = require("../controllers/booklet.controller");
const router = express_1.default.Router();
router.route("/").get(booklet_controller_1.getBooklets).post(booklet_controller_1.createBooklet);
exports.default = router;
