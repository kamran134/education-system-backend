import { IsString } from 'class-validator';

export class CreateDistrictDto {
    @IsString()
    name!: string;
}

export class UpdateDistrictDto {
    @IsString()
    name!: string;
} 