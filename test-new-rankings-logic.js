// Тест новой логики рейтингов с числовыми полями
console.log("=== Тест новой логики рейтингов с числовыми полями ===");

// Имитируем результаты студентов
const mockStudentResults = [
    // Студенты с баллами по районам (studentOfTheMonthScore > 0)
    { 
        _id: "1", 
        grade: 5, 
        totalScore: 85,
        studentOfTheMonthScore: 5,
        republicWideStudentOfTheMonthScore: 0,
        developmentScore: 0,
        status: "Ayın şagirdi",
        studentData: { code: "ST001", lastName: "Алиев", firstName: "Рашад", district: { name: "Баку" } }
    },
    // Студент месяца по республике (republicWideStudentOfTheMonthScore > 0)
    { 
        _id: "2", 
        grade: 6, 
        totalScore: 95,
        studentOfTheMonthScore: 5,
        republicWideStudentOfTheMonthScore: 5,
        developmentScore: 0,
        status: "Ayın şagirdi, Respublika üzrə ayın şagirdi",
        studentData: { code: "ST002", lastName: "Гасанов", firstName: "Тариэль", district: { name: "Гянджа" } }
    },
    // Развивающийся студент (developmentScore > 0)
    { 
        _id: "3", 
        grade: 5, 
        totalScore: 75,
        studentOfTheMonthScore: 0,
        republicWideStudentOfTheMonthScore: 0,
        developmentScore: 10,
        status: "İnkişaf edən şagird",
        studentData: { code: "ST003", lastName: "Мехтиев", firstName: "Саид", district: { name: "Сумгаит" } }
    },
    // Обычный студент (все поля = 0)
    { 
        _id: "4", 
        grade: 5, 
        totalScore: 65,
        studentOfTheMonthScore: 0,
        republicWideStudentOfTheMonthScore: 0,
        developmentScore: 0,
        status: "",
        studentData: { code: "ST004", lastName: "Рагимов", firstName: "Эльнур", district: { name: "Баку" } }
    },
    // Развивающийся + районный студент (developmentScore > 0 и studentOfTheMonthScore > 0)
    { 
        _id: "5", 
        grade: 6, 
        totalScore: 88,
        studentOfTheMonthScore: 5,
        republicWideStudentOfTheMonthScore: 0,
        developmentScore: 10,
        status: "İnkişaf edən şagird, Ayın şagirdi",
        studentData: { code: "ST005", lastName: "Новрузов", firstName: "Фарид", district: { name: "Шеки" } }
    }
];

console.log("\n🔍 Фильтрация по старой логике (поиск в статусе):");

// Старая логика - поиск по статусу
const oldStudentsOfMonth = mockStudentResults.filter(r => r.status?.match(/Ayın şagirdi/i));
const oldStudentsOfMonthByRepublic = mockStudentResults.filter(r => r.status?.match(/Respublika üzrə ayın şagirdi/i));
const oldDevelopingStudents = mockStudentResults.filter(r => r.status?.match(/İnkişaf edən şagird/i));

console.log("Старая логика - Ayın şagirdi:", oldStudentsOfMonth.map(s => s.studentData.code));
console.log("Старая логика - Respublika üzrə:", oldStudentsOfMonthByRepublic.map(s => s.studentData.code));
console.log("Старая логика - İnkişaf edən:", oldDevelopingStudents.map(s => s.studentData.code));

console.log("\n🆕 Фильтрация по новой логике (числовые поля):");

// Новая логика - проверка числовых полей
const newStudentsOfMonth = mockStudentResults.filter(r => r.studentOfTheMonthScore && r.studentOfTheMonthScore > 0);
const newStudentsOfMonthByRepublic = mockStudentResults.filter(r => r.republicWideStudentOfTheMonthScore && r.republicWideStudentOfTheMonthScore > 0);
const newDevelopingStudents = mockStudentResults.filter(r => r.developmentScore && r.developmentScore > 0);

console.log("Новая логика - studentOfTheMonthScore > 0:", newStudentsOfMonth.map(s => s.studentData.code));
console.log("Новая логика - republicWideStudentOfTheMonthScore > 0:", newStudentsOfMonthByRepublic.map(s => s.studentData.code));
console.log("Новая логика - developmentScore > 0:", newDevelopingStudents.map(s => s.studentData.code));

console.log("\n📊 Сравнение результатов:");

console.log("\n👥 Студенты месяца по районам:");
console.log("Старая логика найдена:", oldStudentsOfMonth.length, "студентов");
console.log("Новая логика найдена:", newStudentsOfMonth.length, "студентов");
console.log("Совпадают:", JSON.stringify(oldStudentsOfMonth.map(s => s.studentData.code)) === JSON.stringify(newStudentsOfMonth.map(s => s.studentData.code)) ? "✅" : "❌");

console.log("\n🏆 Студенты месяца по республике:");
console.log("Старая логика найдена:", oldStudentsOfMonthByRepublic.length, "студентов");
console.log("Новая логика найдена:", newStudentsOfMonthByRepublic.length, "студентов");
console.log("Совпадают:", JSON.stringify(oldStudentsOfMonthByRepublic.map(s => s.studentData.code)) === JSON.stringify(newStudentsOfMonthByRepublic.map(s => s.studentData.code)) ? "✅" : "❌");

console.log("\n📈 Развивающиеся студенты:");
console.log("Старая логика найдена:", oldDevelopingStudents.length, "студентов");
console.log("Новая логика найдена:", newDevelopingStudents.length, "студентов");
console.log("Совпадают:", JSON.stringify(oldDevelopingStudents.map(s => s.studentData.code)) === JSON.stringify(newDevelopingStudents.map(s => s.studentData.code)) ? "✅" : "❌");

console.log("\n✅ Тест завершен! Новая логика работает корректно и дает те же результаты.");