"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = __importDefault(require("./config/db"));
const district_routes_1 = __importDefault(require("./routes/district.routes"));
const school_routes_1 = __importDefault(require("./routes/school.routes"));
const teacher_routes_1 = __importDefault(require("./routes/teacher.routes"));
const booklet_routes_1 = __importDefault(require("./routes/booklet.routes"));
const exam_routes_1 = __importDefault(require("./routes/exam.routes"));
const student_routes_1 = __importDefault(require("./routes/student.routes"));
const studentResult_routes_1 = __importDefault(require("./routes/studentResult.routes"));
const stat_routes_1 = __importDefault(require("./routes/stat.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const userSettings_routes_1 = __importDefault(require("./routes/userSettings.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const morgan_1 = __importDefault(require("morgan"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const errorHandler_1 = require("./middleware/errorHandler");
dotenv_1.default.config();
(0, db_1.default)();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Middleware
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)("dev"));
app.use((0, cors_1.default)({
    origin: ['http://localhost:4200', 'https://isim.kpm.az'],
    credentials: true
}));
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// Limit requests
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 300 // Ограничивает 100 запросов с одного IP за 15 минут
});
app.use(limiter);
app.get("/", (req, res) => {
    res.send("API is running!");
});
// Routes
app.use("/api/districts", district_routes_1.default);
app.use("/api/schools", school_routes_1.default);
app.use("/api/teachers", teacher_routes_1.default);
app.use("/api/booklets", booklet_routes_1.default);
app.use("/api/exams", exam_routes_1.default);
app.use("/api/students", student_routes_1.default);
app.use("/api/student-results", studentResult_routes_1.default);
app.use("/api/stats", stat_routes_1.default);
app.use("/api/users", user_routes_1.default);
app.use("/api/user-settings", userSettings_routes_1.default);
app.use("/auth", auth_routes_1.default);
app.use((req, res, next) => {
    res.status(404).json({ message: 'Məlumat tapılmadı' });
});
app.use(errorHandler_1.errorHandler);
app.listen(PORT, () => {
    console.log(`Server run on port http://localhost:${PORT}`);
});
