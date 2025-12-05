import { Router } from 'express';
import { StatisticsController } from '../controllers/statistics.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();
const statisticsController = new StatisticsController();

// Все роуты требуют авторизации
router.use(authMiddleware());

// GET /api/statistics - Получить полную статистику (годовая + помесячная)
router.get('/', (req, res) => statisticsController.getStatistics(req, res));

// GET /api/statistics/yearly - Получить годовую статистику
router.get('/yearly', (req, res) => statisticsController.getYearlyStatistics(req, res));

// GET /api/statistics/monthly - Получить помесячную статистику
router.get('/monthly', (req, res) => statisticsController.getMonthlyStatistics(req, res));

export default router;
