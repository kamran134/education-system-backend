import { FilterOptions } from '../types/common.types';
import { RequestParser } from './request-parser.util';
import { escapeRegex } from './validation.util';

/**
 * Builds a MongoDB filter object from common FilterOptions fields.
 *
 * @param filters      - Incoming filter options
 * @param codeLength   - Number of digits for parseCodeRange (2=district, 3=exam, 5=school, 7=teacher, 10=student)
 * @param searchField  - Document field to apply text search against ('name', 'fullname', …).
 *                       Pass null to skip search (service handles it manually).
 */
export function buildCommonFilter(
    filters: FilterOptions,
    codeLength: number,
    searchField: string | null = 'name'
): Record<string, any> {
    const filter: Record<string, any> = {};

    if (filters.code) {
        const { start, end } = RequestParser.parseCodeRange(filters.code, codeLength);
        filter.code = { $gte: parseInt(start), $lte: parseInt(end) };
    }

    if (searchField !== null && filters.search) {
        filter[searchField] = { $regex: escapeRegex(filters.search), $options: 'i' };
    }

    if (filters.active !== undefined) {
        filter.active = filters.active;
    }

    return filter;
}
