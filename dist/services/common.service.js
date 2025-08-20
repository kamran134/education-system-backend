"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateLevelNumb = exports.calculateLevel = void 0;
const calculateLevel = (totalScore) => {
    if (totalScore >= 16 && totalScore <= 25) {
        return "D";
    }
    else if (totalScore >= 26 && totalScore <= 34) {
        return "C";
    }
    else if (totalScore >= 35 && totalScore <= 41) {
        return "B";
    }
    else if (totalScore >= 42 && totalScore <= 46) {
        return "A";
    }
    else if (totalScore >= 47) {
        return "Lisey";
    }
    else {
        return "E";
    }
};
exports.calculateLevel = calculateLevel;
const calculateLevelNumb = (totalScore) => {
    if (totalScore >= 16 && totalScore <= 25) {
        return 2;
    }
    else if (totalScore >= 26 && totalScore <= 34) {
        return 3;
    }
    else if (totalScore >= 35 && totalScore <= 41) {
        return 4;
    }
    else if (totalScore >= 42 && totalScore <= 46) {
        return 5;
    }
    else if (totalScore >= 47) {
        return 6;
    }
    else {
        return 1;
    }
};
exports.calculateLevelNumb = calculateLevelNumb;
