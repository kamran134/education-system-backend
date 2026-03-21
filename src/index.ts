import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import connectDB from "./config/db";
import districtRoutes from "./routes/district.routes";
import schoolRoutes from "./routes/school.routes";
import teacherRoutes from "./routes/teacher.routes";
import bookletRoutes from "./routes/booklet.routes";
import examRoutes from "./routes/exam.routes";
import studentRoutes from "./routes/student.routes";
import studentResultRoutes from "./routes/studentResult.routes";
import statRoutes from "./routes/stat.routes";
import statisticsRoutes from "./routes/statistics.routes";
import userRoutes from "./routes/user.routes";
import userSettingsRoutes from "./routes/userSettings.routes";
import authRoutes from "./routes/auth.routes";
import examResultsRoutes from "./routes/examResults.routes";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler";
import { startTokenCleanupScheduler } from "./services/token.service";

dotenv.config();
connectDB();

// Запускаем планировщик очистки токенов
startTokenCleanupScheduler();

// Отключаем логи на проде
if (process.env.NODE_ENV === 'production') {
  console.log = function() {};
  console.debug = function() {};
  console.info = function() {};
  console.warn = function() {};
  // console.error оставляем для критичных ошибок
}

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
// Отключаем HTTP логирование на проде (morgan)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan("dev"));
}
// app.use(morgan("dev")); // Закомментировано для отключения на проде
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:4200', 'http://localhost:5173', 'https://isim.kpm.az', 'https://newisim.kpm.az'];

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());

// Статические файлы для аватаров
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Общий лимит для всех запросов (более мягкий)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 300, // 300 запросов за 15 минут (~20 запросов в минуту)
    message: { success: false, message: 'Çox sayda sorğu göndərdiniz. Zəhmət olmasa bir az gözləyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Строгий лимит для auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 20, // 20 попыток входа за 15 минут
    message: { success: false, message: 'Çox sayda giriş cəhdi. Zəhmət olmasa bir az gözləyin.' },
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
app.use("/api/exam-results", examResultsRoutes);
app.use("/api/stats", statRoutes);
app.use("/api/statistics", statisticsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/user-settings", userSettingsRoutes);
app.use("/api/auth", authLimiter, authRoutes);

app.use((req, res, next) => {
    res.status(404).json({ message: 'Məlumat tapılmadı' });
});

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server run on port http://localhost:${PORT}`);
});