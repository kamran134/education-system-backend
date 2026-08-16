import { PublicServicePg, PublicSummary } from "../services/public.service.pg";

export class PublicUseCase {
    constructor(private publicService: PublicServicePg) {}

    async getSummary(): Promise<PublicSummary> {
        return this.publicService.getSummary();
    }
}
