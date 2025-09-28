// Простой тест нашей новой функции updateStudentScores через API
console.log("=== Тест API обновления статистики с подсчетом score ===\n");

const testApiCall = async () => {
    try {
        console.log("🔄 Отправляем POST запрос на /api/stats для обновления статистики...");
        
        const response = await fetch('http://localhost:5000/api/stats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.log(`❌ Ошибка: ${response.status} ${response.statusText}`);
            return;
        }
        
        const result = await response.text();
        console.log("✅ Ответ сервера:");
        console.log(result);
        
    } catch (error) {
        console.log(`❌ Ошибка при запросе: ${error.message}`);
        console.log("\n💡 Убедитесь что сервер запущен на порту 5000");
    }
};

// Используем node-fetch альтернативу для совместимости
const https = require('https');
const http = require('http');

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const protocol = options.port === 443 ? https : http;
        
        const req = protocol.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    text: () => Promise.resolve(body)
                });
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (data) {
            req.write(data);
        }
        
        req.end();
    });
}

const testWithHttpModule = async () => {
    try {
        console.log("🔄 Тестируем обновление статистики через HTTP модуль...");
        
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: '/api/stats',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const response = await makeRequest(options);
        
        if (response.status !== 200) {
            console.log(`❌ Ошибка: ${response.status} ${response.statusText}`);
            return;
        }
        
        const body = await response.text();
        console.log("✅ Статистика успешно обновлена!");
        console.log("📊 Ответ сервера:", body);
        
        console.log("\n🎯 Ожидаемые изменения:");
        console.log("- Обновлены developmentScore, studentOfTheMonthScore, republicWideStudentOfTheMonthScore");
        console.log("- Подсчитан общий score для каждого студента");
        console.log("- Обновлена статистика участия (participationScore)");
        console.log("- В логах должна быть строка: '✅ Обновлен общий score для X студентов'");
        
    } catch (error) {
        console.log(`❌ Ошибка: ${error.message}`);
        if (error.code === 'ECONNREFUSED') {
            console.log("\n💡 Сервер не запущен. Для тестирования:");
            console.log("1. Запустите: cd education-system-back && npx nodemon src/index.ts");
            console.log("2. Затем выполните POST запрос на http://localhost:5000/api/stats");
        }
    }
};

// Запускаем тест
testWithHttpModule();