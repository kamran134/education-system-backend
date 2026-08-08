export interface StatisticsFilter {
    districtIds?: string[];
    schoolIds?: string[];
    teacherIds?: string[];
    grades?: number[];
    examIds?: string[];
    code?: number;
    year?: number; // Учебный год (например, 2024 для 2024-2025)
    month?: string; // Месяц в формате YYYY-MM или число (1-12)
    sortColumn?: string;
    sortDirection?: 'asc' | 'desc';
}

export interface StatusStatistics {
    count: number;
    percentage: number;
}

export interface LevelStatistics {
    E: StatusStatistics;
    D: StatusStatistics;
    C: StatusStatistics;
    B: StatusStatistics;
    A: StatusStatistics;
    Lisey: StatusStatistics;
}

export interface YearlyStatistics {
    totalStudents: number; // Общее количество студентов
    studentsOfMonth: StatusStatistics; // Ayın şagirdləri
    republicStudentsOfMonth: StatusStatistics; // Respublika üzrə ayın şagirdləri
    developingStudents: StatusStatistics; // İnkişaf edən şagirdlər
    averageScore: number; // Orta bal
    levelStatistics: LevelStatistics; // Статистика по уровням
}

export interface MonthlyStatistics {
    month: string; // YYYY-MM
    monthName: string; // Название месяца
    totalResults: number; // Общее количество результатов за месяц
    studentsOfMonth: StatusStatistics;
    republicStudentsOfMonth: StatusStatistics;
    developingStudents: StatusStatistics;
    levelStatistics: LevelStatistics; // Статистика по уровням за месяц
}

export interface StatisticsResponse {
    yearly: YearlyStatistics;
    monthly: MonthlyStatistics[];
}

export interface InkishafStatistics {
    minParticipations: number; // Фильтр — минимум участий
    maxParticipations: number; // Максимум участий в данных (для UI)
    baseCount: number;         // Студентов с >= minParticipations участий
    developingCount: number;   // Из них — inkişaf edən
    percentage: number;        // developingCount / baseCount * 100
}

export interface InkishafFilter extends StatisticsFilter {
    minParticipations?: number;
}

/**
 * Postgres-эпоха: те же фильтры, но id — числа, не Mongo ObjectId-строки.
 * См. types/common.types.ts FilterOptionsPg для объяснения того же паттерна на других сущностях.
 */
export interface StatisticsFilterPg {
    regionIds?: number[];
    districtIds?: number[];
    schoolIds?: number[];
    teacherIds?: number[];
    grades?: number[];
    year?: number;
    month?: string;
}

export interface InkishafFilterPg extends StatisticsFilterPg {
    minParticipations?: number;
}
