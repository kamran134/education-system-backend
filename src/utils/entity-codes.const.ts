/**
 * Entity code system constants.
 *
 * Hierarchy: Student (10 digits) ← Teacher (7) ← School (5) ← District (3)
 *
 * Example: student code 1501880015
 *   → teacher  : 1501880015 / 1_000         = 1501880  (7 digits)
 *   → school   : 1501880015 / 100_000       = 15018    (5 digits)
 *   → district : 1501880015 / 10_000_000    = 150      (3 digits)
 */

/** Number of digits in each entity's code. */
export const CODE_LENGTHS = {
    DISTRICT: 3,
    SCHOOL:   5,
    TEACHER:  7,
    STUDENT:  10,
    EXAM:     3,
} as const;

/** Divisors for extracting a parent entity code from a child code. */
export const CODE_DIVISORS = {
    STUDENT_TO_TEACHER:   1_000,
    STUDENT_TO_SCHOOL:    100_000,
    STUDENT_TO_DISTRICT:  10_000_000,
    TEACHER_TO_SCHOOL:    100,
    TEACHER_TO_DISTRICT:  10_000,
    SCHOOL_TO_DISTRICT:   100,
} as const;

/** Inclusive numeric boundaries for entity code ranges. */
export const CODE_RANGES = {
    STUDENT_MIN: 1_000_000_000,
    STUDENT_MAX: 9_999_999_999,
    SCHOOL_MIN:  10_000,
} as const;
