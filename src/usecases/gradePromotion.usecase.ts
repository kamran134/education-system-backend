import { GradePromotionService, GradePromotionPreview, GradePromotionResult } from "../services/gradePromotion.service";

export class GradePromotionUseCase {
    constructor(private gradePromotionService: GradePromotionService) {}

    async preview(): Promise<GradePromotionPreview> {
        return await this.gradePromotionService.preview();
    }

    async execute(executedByUserId: string): Promise<GradePromotionResult> {
        return await this.gradePromotionService.execute(executedByUserId);
    }
}
