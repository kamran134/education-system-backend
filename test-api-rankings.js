// Тест API с новой логикой рейтингов
console.log("=== Тест API рейтингов с числовыми полями ===\n");

const testApiCall = async (url, description) => {
    try {
        console.log(`🔄 ${description}...`);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.log(`❌ Ошибка: ${response.status} ${response.statusText}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`✅ Успех! Статус: ${response.status}`);
        
        if (data.data) {
            // Новый формат ответа (с data wrapper)
            const { studentsOfMonth, studentsOfMonthByRepublic, developingStudents } = data.data;
            console.log(`   📊 Студенты месяца по районам: ${studentsOfMonth ? studentsOfMonth.length : 0}`);
            console.log(`   🏆 Студенты месяца по республике: ${studentsOfMonthByRepublic ? studentsOfMonthByRepublic.length : 0}`);
            console.log(`   📈 Развивающиеся студенты: ${developingStudents ? developingStudents.length : 0}`);
            
            // Показываем примеры данных
            if (studentsOfMonth && studentsOfMonth.length > 0) {
                const example = studentsOfMonth[0];
                console.log(`   💡 Пример студента месяца: ${example.studentData?.lastName || 'N/A'} (studentOfTheMonthScore: ${example.studentOfTheMonthScore || 0})`);
            }
        } else if (data.studentsOfMonth !== undefined) {
            // Старый формат ответа (без data wrapper)
            const { studentsOfMonth, studentsOfMonthByRepublic, developingStudents } = data;
            console.log(`   📊 Студенты месяца по районам: ${studentsOfMonth ? studentsOfMonth.length : 0}`);
            console.log(`   🏆 Студенты месяца по республике: ${studentsOfMonthByRepublic ? studentsOfMonthByRepublic.length : 0}`);
            console.log(`   📈 Развивающиеся студенты: ${developingStudents ? developingStudents.length : 0}`);
            
            // Показываем примеры данных
            if (studentsOfMonth && studentsOfMonth.length > 0) {
                const example = studentsOfMonth[0];
                console.log(`   💡 Пример студента месяца: ${example.studentData?.lastName || 'N/A'} (studentOfTheMonthScore: ${example.studentOfTheMonthScore || 0})`);
            }
        } else {
            console.log(`   ⚠️  Неожиданный формат данных:`, Object.keys(data));
        }
        
        console.log('');
        return data;
        
    } catch (error) {
        console.log(`❌ Ошибка при запросе: ${error.message}\n`);
        return null;
    }
};

const runTests = async () => {
    const baseUrl = 'http://localhost:5000';
    
    // Тест 1: Статистика по месяцу (новый API)
    await testApiCall(
        `${baseUrl}/api/statistics/students?month=9`,
        'Запрос статистики студентов за сентябрь (новый API)'
    );
    
    // Тест 2: Статистика по конкретному экзамену (если есть)
    // Сначала получим список экзаменов
    try {
        console.log("🔄 Получаем список экзаменов...");
        const examsResponse = await fetch(`${baseUrl}/api/exams/filter`);
        if (examsResponse.ok) {
            const examsData = await examsResponse.json();
            if (examsData && examsData.length > 0) {
                const examId = examsData[0]._id;
                console.log(`✅ Найден экзамен: ${examsData[0].name} (ID: ${examId})`);
                console.log('');
                
                await testApiCall(
                    `${baseUrl}/api/statistics/exams/${examId}`,
                    `Запрос статистики по конкретному экзамену: ${examsData[0].name}`
                );
            } else {
                console.log("⚠️  Экзамены не найдены\n");
            }
        }
    } catch (error) {
        console.log(`❌ Ошибка при получении экзаменов: ${error.message}\n`);
    }
    
    console.log("🎯 Тестирование завершено!");
    console.log("✅ Новая логика использует числовые поля вместо поиска в статусах");
    console.log("📊 studentOfTheMonthScore > 0 → студенты месяца по районам");
    console.log("🏆 republicWideStudentOfTheMonthScore > 0 → студенты месяца по республике");
    console.log("📈 developmentScore > 0 → развивающиеся студенты");
};

// Запускаем тесты
runTests().catch(console.error);