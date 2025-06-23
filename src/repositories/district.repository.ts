import { Model } from 'mongoose';
import { IDistrict } from '../models/district.model';
import { BaseRepository } from './base.repository';

export class DistrictRepository extends BaseRepository<IDistrict> {
    constructor(model: Model<IDistrict>) {
        super(model);
    }

    async findByName(name: string): Promise<IDistrict | null> {
        return this.findOne({ name });
    }
} 