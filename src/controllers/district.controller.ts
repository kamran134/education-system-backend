import { Request, Response } from "express";
import District from "../models/district.model";
import { checkExistingDistrict } from "../services/district.service";

export const getDistricts = async (req: Request, res: Response) => {
    try {
        const [data, totalCount] = await Promise.all([
            District.find().sort({ name: 1}),
            District.countDocuments()
        ]);

        res.status(200).json({ data, totalCount });
    } catch (error) {
        res.status(500).json({ message: "Rayonların alınmasında xəta", error });
    }
};

export const createDistrict = async (req: Request, res: Response) => {
    try {
        const { name, region, code } = req.body;
        const district = new District({ name, region, code });
        const checkDistrictToExist = await checkExistingDistrict(district);

        if (!checkDistrictToExist) {
            const savedDistrict = await district.save();
            res.status(201).json({savedDistrict, message: 'Rayon uğurla əlavə edildi'});
        }
        else {
            res.status(409).json({ message: 'Rayon artıq bazada var' });
        }
    } catch (error) {
        res.status(500).json({ message: "Rayonun yaradılmasında xəta!", error });
    }
};

export const createAllDistricts = async (req: Request, res: Response) => {
    try {
        const reqBody = req.body;
        if (!Array.isArray(reqBody)) {
            res.status(400).json({ message: "Verilənlər massiv deyil!" });
        }
        else {
            // Используем insertMany для массовой вставки
            const savedDistricts = await District.insertMany(reqBody);
            // Отправляем ответ с массивом сохранённых объектов
            res.status(201).json(savedDistricts);
        }
    } catch (error) {
        res.status(500).json({ message: "Rayonların yaradılmasında xəta", error })
    }
}