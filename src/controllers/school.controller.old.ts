import { Request, Response } from "express";
import School, { ISchool, ISchoolInput } from "../models/school.model";
import District from "../models/district.model";
import mongoose, { Types } from "mongoose";
import { deleteFile } from "../services/file.service";
import { checkExistingSchoolCodes, deleteSchoolById, deleteSchoolsByIds, getFiltredSchools } from "../services/school.service";
import { checkExistingDistricts } from "../services/district.service";
import { readExcel } from "../services/excel.service";

export const getSchools = async (req: Request, res: Response) => {
    try {
        const { data, totalCount } = await getFiltredSchools(req);
        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Məktəblərin alınmasında xəta", error });
    }
}

export const getSchoolsForFilter = async (req: Request, res: Response) => {
    try {
        const districtIds: mongoose.Types.ObjectId[] = req.query.districtIds
            ? (req.query.districtIds as string).split(',').map(id => new mongoose.Types.ObjectId(id.trim()))
            : [];
        
        const filter: any = {};

        if (districtIds.length > 0) {
            filter.district = { $in: districtIds };
        }

        console.log(filter);

        const [data, totalCount] = await Promise.all([
            School.find(filter)
                .sort({ name: 1 }),
            School.countDocuments(filter)
        ]);

        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Məktəblərin alınmasında xəta", error });
    }
}

export const createSchool = async (req: Request, res: Response) => {
    try {
        const { name, address, code, district, active } = req.body;
  
        if (!name || !code || !district) {
            res.status(400).json({ message: "Məlumatlar tam deyil" });
            return;
        }

        if (code.toString().length !== 5) {
            res.status(400).json({ message: "Məktəb kodu 5 simvoldan ibarət olmalıdır" });
            return;
        }

        const existingDistrict = await District.findOne({ code: district.code });
        if (!existingDistrict) {
            res.status(400).json({ message: "Bu kodda rayon tapılmadı" });
            return;
        }
  
        const school = new School({
            name,
            address,
            code,
            districtCode: existingDistrict.code,
            district: existingDistrict._id,
            active
        });

        // Check if school with the same code already exists
        const existingSchool = await School.findOne({ code });
        if (existingSchool) {
            res.status(400).json({ message: "Bu kodda məktəb artıq mövcuddur" });
            return;
        }
  
        // const savedSchool = await school.save();
        // create a new school and return with populated district
        const savedSchool = await School.create(school);
        await savedSchool.populate('district', 'name code');
        res.status(201).json({message: "Məktəb uğurla yaradıldı! ", data: savedSchool});
    } catch (error) {
        res.status(500).json({ message: "Məktəbin yaradılmasında xəta", error });
    }
}

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
        const newSchools: ISchoolInput[] = existingSchoolCodes.length > 0 ?
            correctSchoolsToInsert.filter(data => !existingSchoolCodes.includes(data.code))
            : correctSchoolsToInsert;

        // Отделяем те строки, где не был указан код района, их выведем в конце на фронт
        const districtCodes = newSchools.filter(item => item.districtCode > 0).map(item => item.districtCode);
        const schoolCodesWithoutDistrictCodes = newSchools.filter(item => item.districtCode === 0).map(item => item.code);

        // Проверяем все ли указанные районы существуют у нас в базе
        const existingDistricts = await checkExistingDistricts(districtCodes);
        const existingDistrictCodes = existingDistricts.map(d => d.code);
        const missingDistrictCodes = districtCodes.filter(code => !existingDistrictCodes.includes(code!));

        const districtMap = existingDistricts.reduce((map, district) => {
            map[district.code] = district._id as Types.ObjectId;
            return map;
        }, {} as Record<string, Types.ObjectId>);

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
                district: districtMap[item.districtCode],
                active: true
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

export const updateSchool = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const school: ISchool = req.body as ISchool;
        
        // first we check if teacher district and school are valid and changed
        if (school.district) {
            const district = await District.findById(school.district);
            if (!district) {
                res.status(400).json({ message: "Bu kodda rayon tapilmadi" });
                return;
            }
        }

        // check changed fields of teacher
        const existingSchool = await School.findById(id);
        if (!existingSchool) {
            res.status(404).json({ message: "Məktəb tapılmadı" });
            return;
        }

        let isUpdated = false;
        if (existingSchool.district !== school.district) {
            existingSchool.district = school.district;
            isUpdated = true;
        }

        if (existingSchool.name !== school.name) {
            existingSchool.name = school.name;
            isUpdated = true;
        }

        if (existingSchool.address !== school.address) {
            existingSchool.address = school.address;
            isUpdated = true;
        }

        if (existingSchool.code !== school.code) {
            existingSchool.code = school.code;
            isUpdated = true;
        }

        if (existingSchool.active !== school.active) {
            existingSchool.active = school.active;
            isUpdated = true;
        }

        if (isUpdated) {
            await existingSchool.save();
            res.status(200).json(existingSchool);
            return;
        }
    } catch (error) {
        res.status(500).json({ message: "Məktəbin yenilənməsində xəta", error });
    }
}

export const deleteSchool = async (req: Request, res: Response) => {
    try {
        const schoolId = req.params.id;
        const result = await deleteSchoolById(schoolId);
        res.status(200).json(result);
    }
    catch (error) {
        res.status(500).json(error);
        console.error(error);
    }
}

export const deleteSchools = async (req: Request, res: Response) => {
    try {
        const { schoolIds } = req.params;
        if (schoolIds.length === 0) {
            res.status(400).json({ message: "Məktəblər seçilməyib" });
            return;
        }
        const schoolIdsArr = schoolIds.split(",");
        const result = await deleteSchoolsByIds(schoolIdsArr);

        if (result.deletedCount === 0) {
            res.status(404).json({ message: "Silinmək üçün seçilən məktəblər bazada tapılmadı" });
            return;
        }

        res.status(200).json({ message: `${result.deletedCount} məktəb bazadan silindi!` });
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