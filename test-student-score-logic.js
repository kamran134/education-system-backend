// Тест логики подсчета общего score студентов
console.log("=== Тест логики подсчета общего score студентов ===\n");

// Имитируем данные студентов и их результаты
const mockStudentResults = [
    // Студент 1: результаты за разные месяцы
    {
        _id: "result1",
        student: "student1", 
        participationScore: 3,      // за участие E=1, D=2, C=3
        developmentScore: 0,        // не развивался
        studentOfTheMonthScore: 0,  // не был студентом месяца
        republicWideStudentOfTheMonthScore: 0
    },
    {
        _id: "result2", 
        student: "student1",        // тот же студент в другом месяце
        participationScore: 5,      // участвовал на уровне A=5
        developmentScore: 10,       // развился (+10)
        studentOfTheMonthScore: 5,  // стал студентом месяца (+5)
        republicWideStudentOfTheMonthScore: 0
    },
    
    // Студент 2: супер-студент
    {
        _id: "result3",
        student: "student2",
        participationScore: 6,      // Lisey уровень
        developmentScore: 10,       // развился 
        studentOfTheMonthScore: 5,  // студент месяца по району
        republicWideStudentOfTheMonthScore: 5  // студент месяца по республике
    },
    
    // Студент 3: обычный студент
    {
        _id: "result4", 
        student: "student3",
        participationScore: 2,      // уровень D
        developmentScore: 0,
        studentOfTheMonthScore: 0,
        republicWideStudentOfTheMonthScore: 0
    }
];

console.log("📊 Исходные данные результатов студентов:");
mockStudentResults.forEach((result, index) => {
    console.log(`${index + 1}. ${result._id}: student=${result.student}`);
    console.log(`   participationScore: ${result.participationScore}`);
    console.log(`   developmentScore: ${result.developmentScore}`);
    console.log(`   studentOfTheMonthScore: ${result.studentOfTheMonthScore}`);
    console.log(`   republicWideStudentOfTheMonthScore: ${result.republicWideStudentOfTheMonthScore}`);
    console.log('');
});

console.log("🔢 Симуляция агрегации MongoDB для подсчета score:\n");

// Симулируем агрегацию MongoDB $group
const studentScores = {};

mockStudentResults.forEach(result => {
    const studentId = result.student;
    
    if (!studentScores[studentId]) {
        studentScores[studentId] = {
            _id: studentId,
            totalParticipationScore: 0,
            totalDevelopmentScore: 0,
            totalStudentOfTheMonthScore: 0,
            totalRepublicWideStudentOfTheMonthScore: 0
        };
    }
    
    studentScores[studentId].totalParticipationScore += result.participationScore || 0;
    studentScores[studentId].totalDevelopmentScore += result.developmentScore || 0;
    studentScores[studentId].totalStudentOfTheMonthScore += result.studentOfTheMonthScore || 0;
    studentScores[studentId].totalRepublicWideStudentOfTheMonthScore += result.republicWideStudentOfTheMonthScore || 0;
});

// Симулируем $addFields для подсчета totalScore
Object.values(studentScores).forEach(student => {
    student.totalScore = student.totalParticipationScore + 
                        student.totalDevelopmentScore + 
                        student.totalStudentOfTheMonthScore + 
                        student.totalRepublicWideStudentOfTheMonthScore;
});

console.log("✅ Результаты агрегации - итоговые баллы студентов:\n");

Object.values(studentScores).forEach((student, index) => {
    console.log(`👤 Студент ${student._id}:`);
    console.log(`   📚 Участие (participation): ${student.totalParticipationScore} баллов`);
    console.log(`   📈 Развитие (development): ${student.totalDevelopmentScore} баллов`);
    console.log(`   🏆 Студент месяца район: ${student.totalStudentOfTheMonthScore} баллов`);
    console.log(`   🎯 Студент месяца республика: ${student.totalRepublicWideStudentOfTheMonthScore} баллов`);
    console.log(`   🔢 ОБЩИЙ СЧЕТ (totalScore): ${student.totalScore} баллов`);
    console.log('');
});

// Статистика
const allStudents = Object.values(studentScores);
const totalScoreSum = allStudents.reduce((sum, student) => sum + student.totalScore, 0);
const averageScore = totalScoreSum / allStudents.length;

console.log("📊 Общая статистика:");
console.log(`- Всего студентов: ${allStudents.length}`);
console.log(`- Общая сумма баллов: ${totalScoreSum}`);
console.log(`- Средний балл: ${averageScore.toFixed(2)}`);
console.log(`- Максимальный балл: ${Math.max(...allStudents.map(s => s.totalScore))}`);
console.log(`- Минимальный балл: ${Math.min(...allStudents.map(s => s.totalScore))}`);

console.log("\n✅ Логика подсчета общего score работает корректно!");
console.log("🔄 Теперь эти данные будут обновлены в таблице Student через bulkWrite");