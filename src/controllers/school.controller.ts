import { Request, Response } from "express";
import School, { ISchoolInput } from "../models/school.model";
import District from "../models/district.model";
import mongoose from "mongoose";
import { deleteFile } from "../services/file.service";
import { checkExistingSchoolCodes } from "../services/school.service";
import { checkExistingDistricts } from "../services/district.service";
import { readExcel } from "../services/excel.service";

export const getSchools = async (req: Request, res: Response) => {
    try {
        const page: number = parseInt(req.query.page as string) || 1;
        const size: number = parseInt(req.query.size as string) || 10;
        const skip: number = (page - 1) * size;
        const districtIds: string[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',')
            : [];

        const filter: any = {};

        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }

        const [data, totalCount] = await Promise.all([
            School.find(filter)
                .populate('district')
                .sort({ averageScore: -1 })
                .skip(skip)
                .limit(size),
            School.countDocuments(filter)
        ]);

        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Məktəblərin alınmasında xəta", error });
    }
};

export const getSchoolsForFilter = async (req: Request, res: Response) => {
    try {
        const districtIds: mongoose.Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new mongoose.Types.ObjectId(id.trim()))
            : [];
        
        const filter: any = {};

        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }

        const [data, totalCount] = await Promise.all([
            School.find(filter)
                .sort({ name: 1 }),
            School.countDocuments(filter)
        ]);

        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Məktəblərin alınmasında xəta", error });
    }
};

export const createSchool = async (req: Request, res: Response) => {
    try {
        const { name, address, code, districtCode } = req.body;
  
        const existingDistrict = await District.findOne({ code: districtCode });
        if (!existingDistrict) {
            res.status(400).json({ message: "Bu kodda rayon tapılmadı" });
            return;
        }
  
        const school = new School({
            name,
            address,
            code,
            district: existingDistrict._id,
        });
  
        const savedSchool = await school.save();
        res.status(201).json(savedSchool);
    } catch (error) {
        res.status(500).json({ message: "Məktəbin yaradılmasında xəta", error });
    }
};

export const createAllSchools = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ message: "Fayl yüklənməyib!" });
            return;
        }

        const rows: any[] = readExcel(req.file.path);
        
        if (rows.length < 5) {
            console.warn('Not enough rows');
            res.status(400).json({ message: "Faylda kifayət qədər sətr yoxdur!" });
            return;
        }

        // прочли и присвоили модели
        const dataToInsert: ISchoolInput[] = rows.slice(4).map(row => ({
            districtCode: Number(row[1]) || 0,
            code: Number(row[2]),
            name: String(row[3]),
            address: ''
        }));

        // Выявляем и отсеиваем некорректных учителей
        const correctSchoolsToInsert = dataToInsert.filter(data => data.code > 9999);
        const incorrectSchoolCodes = dataToInsert.filter(data => data.code <= 9999).map(data => data.code);

        // Сначала отсеиваем школы, которые уже есть
        const existingSchoolCodes: number[] = await checkExistingSchoolCodes(correctSchoolsToInsert.map(data => data.code));
        const newSchools: ISchoolInput[] = correctSchoolsToInsert.filter(data => !existingSchoolCodes.includes(data.code));

        // Отделяем те строки, где не был указан код района, их выведем в конце на фронт
        const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
        const schoolCodesWithoutDistrictCodes = newSchools.filter(item => item.districtCode === 0).map(item => item.code);

        // Проверяем все ли указанные районы существуют у нас в базе
        const existingDistricts = await checkExistingDistricts(districtCodes);
        const existingDistrictCodes = existingDistricts.map(d => d.code);
        const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code!));

        const districtMap = existingDistricts.reduce((map, district) => {
            map[district.code] = String(district._id);
            return map;
        }, {} as Record<string, string>);

        const schoolsToSave = newSchools.filter(
            item =>
                item.code > 0 && 
                !missingDistrictCodes.includes(item.districtCode) && 
                !schoolCodesWithoutDistrictCodes.includes(item.code)
        ).map(
            item => ({
                name: item.name,
                address: item.address,
                code: item.code,
                districtCode: item.districtCode,
                district: districtMap[item.districtCode]
        }));

        // Remove the uploaded file
        deleteFile(req.file.path);
        
        if (schoolsToSave.length === 0) {
            res.status(201).json({
                message: "Bütün məktəblər bazada var!",
                missingDistrictCodes,
                schoolCodesWithoutDistrictCodes,
                incorrectSchoolCodes
            });
            return;
        }

        const results = await School.collection.bulkWrite(
            schoolsToSave.map(school => ({
                updateOne: {
                    filter: { code: school.code }, 
                    update: { $set: school }, 
                    upsert: true 
                }
            }))
        );
      
        // Analyze results for success and failures
        const numCreated = results.upsertedCount;
        const numUpdated = results.modifiedCount;

        res.status(201).json({
            message: "Fayl uğurla yükləndi!",
            details: `Yeni məktəblər: ${numCreated}\nYenilənən məktəblər: ${numUpdated}`,
            missingDistrictCodes,
            schoolCodesWithoutDistrictCodes
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Məktəblərin yaradılmasında xəta", error })
    }
}

export const deleteSchool = async (req: Request, res: Response) => {
    try {
        const result = await School.findByIdAndDelete(req.params.id);
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
}

export const deleteSchoolsByIds = async (req: Request, res: Response) => {
    try {
        const { schoolIds } = req.params;
        if (schoolIds.length === 0) {
            res.status(400).json({ message: "Məktəblər seçilməyib" });
            return;
        }
        const schoolIdsArr = schoolIds.split(",");
        // console.log(schoolIdsArr);
        // const deletedStudents = {deletedCount: 0};
        const deletedStudents = await School.deleteMany({ _id: { $in: schoolIdsArr } });

        if (deletedStudents.deletedCount === 0) {
            res.status(404).json({ message: "Silinmək üçün seçilən məktəblər bazada tapılmadı" });
            return;
        }

        res.status(200).json({ message: `${deletedStudents.deletedCount} məktəb bazadan silindi!` });
    } catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
}

export const repairSchools = async (req: Request, res: Response) => {
    try {
        const schools = await School.find().populate('district');

        const schoolsWithoutDistrict: string[] = [];
        const repairedSchools: string[] = [];

        for (let school of schools) {
            const schoolCode: string = school.code.toString();
            if (schoolCode.length !== 5) continue;

            let isUpdated = false;

            if (!school.district) {
                const districtCode = schoolCode.substring(0, 3);
                const district = await District.findOne({ code: districtCode });

                if (district) {
                    school.district = district;
                    isUpdated = true;
                } else {
                    schoolsWithoutDistrict.push(school.code.toString());
                }
            }

            if (isUpdated) {
                await school.save();
                repairedSchools.push(school.code.toString());
            }
        }

        res.status(200).json({
            message: "Məktəblərin məlumatları yeniləndi",
            repairedSchools,
            schoolsWithoutDistrict,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Müəllimlərin alınmasında xəta", error });
    }
}