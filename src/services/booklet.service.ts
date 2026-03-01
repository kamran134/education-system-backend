import { Types } from "mongoose";
import xlsx from "xlsx";
import Booklet, { IBooklet, IBookletCreate, IBookletDisciplines } from "../models/booklet.model";
import District from "../models/district.model";
import { PaginationOptions, SortOptions } from "../types/common.types";
import { deleteFile } from "./file.service";

/** Reads an Excel file and returns rows as arrays of display (formatted) values. */
const readBookletExcel = (filePath: string): any[][] => {
    const workbook = xlsx.readFile(filePath, { cellFormula: false });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: null });
};

export interface BookletFilterOptions {
    examId?: Types.ObjectId | string;
    districtId?: Types.ObjectId | string;
    variant?: string;
    grade?: number;
}

export class BookletService {
    async findById(id: string): Promise<IBooklet | null> {
        return await Booklet.findById(id).populate("exam").populate("district");
    }

    async findOne(filter: BookletFilterOptions): Promise<IBooklet | null> {
        return await Booklet.findOne(this.buildFilter(filter));
    }

    async create(data: IBookletCreate): Promise<IBooklet> {
        const booklet = new Booklet(data);
        return await booklet.save();
    }

    async update(id: string, updateData: Partial<IBookletCreate>): Promise<IBooklet> {
        const updated = await Booklet.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate("exam");

        if (!updated) {
            throw new Error("Booklet not found");
        }

        return updated;
    }

    async delete(id: string): Promise<void> {
        const result = await Booklet.findByIdAndDelete(id);
        if (!result) {
            throw new Error("Booklet not found");
        }
    }

    async upsert(
        examId: string,
        variant: string,
        grade: number,
        disciplines: IBookletDisciplines,
        districtId?: string,
        name?: string
    ): Promise<IBooklet> {
        const updatePayload: Record<string, any> = { exam: examId, variant, grade, disciplines };
        if (districtId) updatePayload.district = districtId;
        if (name)       updatePayload.name      = name;

        return await Booklet.findOneAndUpdate(
            { exam: examId, variant, grade },
            updatePayload,
            { upsert: true, new: true, runValidators: true }
        ) as IBooklet;
    }

    /**
     * Excel structure:
     *   Row 3 (index 2): column headers
     *   Row 4+ (index 3+): answer rows
     *     col 0 – variant  (constant, taken from first row)
     *     col 1 – grade    (constant, taken from first row)
     *     col 2 – question number (skipped, position = array index)
     *     col 3+ – discipline answers, identified by header name
     *
     * Header → field mapping (trim + lowercase, partial match):
     *   "azərb..." → az
     *   "riyaz..." → math
     *   "həyat..." → lifeKnowledge
     *   "məntiq"   → logic
     *   "ingilis"  → english
     */
    async parseAndUpsertFromExcel(
        filePath: string,
        examId: string
    ): Promise<{ processedCount: number; errors: string[] }> {
        const errors: string[] = [];

        try {
            const rows: any[][] = readBookletExcel(filePath);

            // rows[0] = row 1 (title), rows[1] = row 2 (empty),
            // rows[2] = row 3 (headers), rows[3]+ = data rows
            if (rows.length < 4) {
                throw new Error("Fayl düzgün formatda deyil: minimum 4 sətir lazımdır");
            }

            // Read district code from B1 (row 0, col 1) and booklet name from D1 (row 0, col 3)
            const row1: any[] = rows[0];
            const districtCodeRaw = row1?.[1];
            const bookletName     = String(row1?.[3] ?? "").trim() || undefined;

            let districtId: string | undefined;
            if (districtCodeRaw != null && String(districtCodeRaw).trim() !== "") {
                const districtCode = Number(String(districtCodeRaw).trim());
                if (isNaN(districtCode)) {
                    throw new Error(`B1 xanasındakı rayon kodu düzgün deyil: "${districtCodeRaw}"`);
                }
                const district = await District.findOne({ code: districtCode });
                if (!district) {
                    throw new Error(`${districtCode} kodlu rayon tapılmadı`);
                }
                districtId = district._id.toString();
            }

            const headerRow: any[] = rows[2]; // row 3 (0-indexed)
            const dataRows: any[][] = rows.slice(3); // row 4+ (0-indexed)

            // Detect all column indices from the header row
            let variantColIdx = 0;  // fallback: column A
            let gradeColIdx   = 1;  // fallback: column B
            const colMap: Partial<Record<keyof IBookletDisciplines, number>> = {};

            headerRow.forEach((cell: any, idx: number) => {
                if (cell == null) return;
                const normalized = String(cell).trim().toLowerCase();

                if (normalized.includes("variant"))      variantColIdx = idx;
                else if (normalized.includes("sinif") || normalized.includes("klas")) gradeColIdx = idx;
                else if (normalized.includes("azərb"))   colMap.az            = idx;
                else if (normalized.includes("riyaz"))   colMap.math          = idx;
                else if (normalized.includes("həyat"))   colMap.lifeKnowledge = idx;
                else if (normalized.includes("məntiq"))  colMap.logic         = idx;
                else if (normalized.includes("ingilis")) colMap.english       = idx;
            });

            if (Object.keys(colMap).length === 0) {
                throw new Error("Fayl başlıqlarında fənn sütunları tapilmadı");
            }

            const firstRow = dataRows[0];
            const variant = String(firstRow?.[variantColIdx] ?? "").trim();
            const grade   = Number(String(firstRow?.[gradeColIdx] ?? "").trim());

            if (!variant) throw new Error(`Variant tapılmadı (sətir 4, sütun indeks ${variantColIdx})`);
            if (!grade || isNaN(grade)) throw new Error(`Sinif tapılmadı (sətir 4, sütun indeks ${gradeColIdx})`);

            // Collect answers per discipline
            const disciplines: IBookletDisciplines = {};
            for (const [field, colIdx] of Object.entries(colMap) as [keyof IBookletDisciplines, number][]) {
                const answers: string[] = dataRows
                    .map(row => String(row[colIdx] ?? "").trim())
                    .filter(val => val !== "" && val !== "null");

                if (answers.length > 0) {
                    disciplines[field] = answers;
                }
            }

            await this.upsert(examId, variant, grade, disciplines, districtId, bookletName);

            return { processedCount: 1, errors };
        } finally {
            deleteFile(filePath);
        }
    }

    async getFiltered(
        pagination: PaginationOptions,
        filters: BookletFilterOptions,
        sort: SortOptions
    ): Promise<{ data: IBooklet[]; totalCount: number }> {
        const filter = this.buildFilter(filters);

        const sortOptions: Record<string, 1 | -1> = {};
        sortOptions[sort.sortColumn] = sort.sortDirection === "asc" ? 1 : -1;

        const [data, totalCount] = await Promise.all([
            Booklet.find(filter)
                .populate("exam")
                .populate("district")
                .sort(sortOptions)
                .skip(pagination.skip)
                .limit(pagination.size),
            Booklet.countDocuments(filter),
        ]);

        return { data, totalCount };
    }

    private buildFilter(filters: BookletFilterOptions): Record<string, any> {
        const filter: Record<string, any> = {};

        if (filters.examId) {
            filter.exam = filters.examId;
        }
        if (filters.districtId) {
            filter.district = filters.districtId;
        }
        if (filters.variant) {
            filter.variant = filters.variant;
        }
        if (filters.grade !== undefined) {
            filter.grade = filters.grade;
        }

        return filter;
    }
}
