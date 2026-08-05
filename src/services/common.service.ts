import { getLevelByScore } from "./levels.cache";

export const calculateLevel = (totalScore: number): string => {
    return getLevelByScore(totalScore).code;
}

export const calculateLevelNumb = (totalScore: number): number => {
    return getLevelByScore(totalScore).rank;
}
