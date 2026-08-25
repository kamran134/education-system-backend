import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import districtRoutes from "./routes/district.routes";
import regionRoutes from "./routes/region.routes";
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
import academicYearRoutes from "./routes/gradePromotion.routes";
import referenceRoutes from "./routes/reference.routes";
import certificateRoutes from "./routes/certificate.routes";
import publicRoutes from "./routes/public.routes";
import profileChangeRoutes from "./routes/profileChange.routes";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler";
import { startTokenCleanupScheduler } from "./services/token.service.pg";
import { loadLevelsCache } from "./services/levels.cache";
import { academicYearClosureServicePg } from "./services/academicYearClosure.service.pg";

dotenv.config();

// MongoDB больше не требуется: последний живой потребитель (statistics.service.ts) перенесён
// на Kysely/Postgres 08.08.2026 (см. statistics.service.pg.ts). connectDB() раньше делал
// process.exit(1) при недоступности Mongo — воспроизведено вживую при отладке региональных
// управлений: весь бэкенд крашился, если MONGO_URI недостижим, даже когда ни один реальный
// запрос Mongo не требовал. MONGO_URI/mongoose оставлены в package.json/.env только как
// историческая зависимость — не читаются нигде в рантайме.

// Запускаем планировщик очистки токенов
startTokenCleanupScheduler();

// Отключаем логи на проде
if (process.env.NODE_ENV === 'production') {
  // Сохраняем оригинальный console.log для auth-логов
  const originalLog = console.log.bind(console);
  console.log = function(...args: any[]) {
    // Пропускаем auth-логи в проде для диагностики
    if (typeof args[0] === 'string' && (args[0].startsWith('[LOGIN]') || args[0].startsWith('[REFRESH TOKEN]'))) {
      originalLog(...args);
    }
  };
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
// Аутентифицированные пользователи (Bearer token) не подпадают под лимит —
// брутфорс-угроза актуальна только для анонимных запросов.
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dəqiqə
    max: 100, // 100 sorğu dəqiqədə anonim IP-dən
    message: { success: false, message: 'Çox sayda sorğu göndərdiniz. Zəhmət olmasa bir az gözləyin.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Autentifikasiya olunmuş requestləri say — onlar artıq loginə görə yoxlanılıb
        const authHeader = req.headers.authorization;
        return !!(authHeader && authHeader.startsWith('Bearer '));
    },
});

// Строгий лимит только для login/register (защита от брутфорса)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 20, // 20 попыток за 15 минут
    message: { success: false, message: 'Çox sayda giriş cəhdi. Zəhmət olmasa bir az gözləyin.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Не считаем refresh, me, logout — только login/register
    skip: (req) => {
        const path = req.path;
        return path === '/refresh' || path === '/me' || path === '/logout' || path === '/logout-all' || path === '/sessions';
    },
});

app.use(generalLimiter);

app.get("/", (req, res) => {
    res.send("API is running!");
});

// Routes
app.use("/api/districts", districtRoutes);
app.use("/api/regions", regionRoutes);
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
app.use("/api/academic-year", academicYearRoutes);
app.use("/api/reference", referenceRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/profile-changes", profileChangeRoutes);
app.use("/api/auth", authLimiter, authRoutes);

app.use((req, res, next) => {
    res.status(404).json({ message: 'Məlumat tapılmadı' });
});

app.use(errorHandler);

loadLevelsCache()
    .then(async () => {
        // Авто-закрытие учебных годов (ACADEMIC_YEAR_ARCHIVE_TASK.md §3) — не фатально:
        // это предохранитель поверх ручного закрытия, не критичная для старта функциональность.
        try {
            const closed = await academicYearClosureServicePg.ensureFinishedYearsClosed();
            if (closed.length > 0) {
                console.log(`Avtomatik bağlanmış tədris illəri: ${closed.join(", ")}`);
            }
        } catch (err) {
            console.error("Failed to auto-close finished academic years on startup:", err);
        }

        app.listen(PORT, () => {
            console.log(`Server run on port http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error("Failed to load levels cache on startup:", err);
        process.exit(1);
    });