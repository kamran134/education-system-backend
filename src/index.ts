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
import authRoutes from "./routes/auth.routes";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler";

dontenv.config();
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(morgan("dev"));
app.use(cors({
    origin: ['http://localhost:4200', 'http://157.230.29.19'],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Limit requests
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 300 // Ограничивает 100 запросов с одного IP за 15 минут
});
app.use(limiter);

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
app.use("/auth", authRoutes)

app.use((req, res, next) => {
    res.status(404).json({ message: 'Məlumat tapılmadı' });
});

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server run on port http://localhost:${PORT}`);
});