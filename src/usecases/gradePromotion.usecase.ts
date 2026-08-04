import { GradePromotionServicePg, GradePromotionPreview, GradePromotionResult } from "../services/gradePromotion.service.pg";

export class GradePromotionUseCase {
    constructor(private gradePromotionService: GradePromotionServicePg) {}

    async preview(): Promise<GradePromotionPreview> {
        return await this.gradePromotionService.preview();
    }

    async execute(executedByUserId: number): Promise<GradePromotionResult> {
        return await this.gradePromotionService.execute(executedByUserId);
    }
}
