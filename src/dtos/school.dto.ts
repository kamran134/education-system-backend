import { IsString, IsOptional, IsMongoId } from 'class-validator';

export class CreateSchoolDto {
    @IsString()
    name!: string;

    @IsMongoId()
    district!: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    phone?: string;
}

export class UpdateSchoolDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsMongoId()
    @IsOptional()
    district?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    phone?: string;
} 