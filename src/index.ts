import express from "express";
import cors from "cors";
import dontenv from "dotenv";
import connectDB from "./config/db";
import districtRoutes from "./routes/district.routes";
import schoolRoutes from "./routes/school.routes";
import teacherRoutes from "./routes/teacher.routes";
import bookletRoutes from "./routes/booklet.routes";
import examRoutes from "./routes/exam.routes";
import studentRoutes from "./routes/student.routes";
import studentResultRoutes from "./routes/studentResult.routes";
import statRoutes from "./routes/stat.routes";
import userRoutes from "./routes/user.routes";
import userSettingsRoutes from "./routes/userSettings.routes";
import authRoutes from "./routes/auth.routes";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler";
import { startTokenCleanupScheduler } from "./services/token.service";

dontenv.config();
connectDB();

// Запускаем планировщик очистки токенов
startTokenCleanupScheduler();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(morgan("dev"));
app.use(cors({
    origin: [
        'http://localhost:4200', 
        'http://localhost:5173', 
        'https://isim.kpm.az',
        'https://newisim.kpm.az'
    ],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Общий лимит для всех запросов (более мягкий)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 1000, // 1000 запросов за 15 минут (~66 запросов в минуту)
    message: { success: false, message: 'Çox sayda sorğu göndərdiniz. Zəhmət olmasa bir az gözləyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(generalLimiter);

app.get("/", (req, res) => {
    res.send("API is running!");
});

// Routes
app.use("/api/districts", districtRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/teachers", teacherRoutes);
app.use("/api/booklets", bookletRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/student-results", studentResultRoutes);
app.use("/api/stats", statRoutes);
app.use("/api/users", userRoutes);
app.use("/api/user-settings", userSettingsRoutes);
app.use("/api/auth", authRoutes); // Auth роуты без дополнительных ограничений

app.use((req, res, next) => {
    res.status(404).json({ message: 'Məlumat tapılmadı' });
});

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server run on port http://localhost:${PORT}`);
});