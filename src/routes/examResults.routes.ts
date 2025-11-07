import { Router } from 'express';
import { ExamResultsController } from '../controllers/examResults.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
const examResultsController = new ExamResultsController();

// GET /api/exam-results - Get exam results with filtering and pagination
router.get('/', authMiddleware(), examResultsController.getExamResults.bind(examResultsController));

// GET /api/exam-results/:id - Get specific exam result by ID
router.get('/:id', authMiddleware(), examResultsController.getExamResultById.bind(examResultsController));

export default router;