// Проверяем какие секреты используются в runtime
require('dotenv').config();
console.log('Environment variables:');
console.log('JWT_SECRET:', process.env.JWT_SECRET || 'НЕ УСТАНОВЛЕН');
console.log('JWT_REFRESH_SECRET:', process.env.JWT_REFRESH_SECRET || 'НЕ УСТАНОВЛЕН');
console.log('NODE_ENV:', process.env.NODE_ENV || 'НЕ УСТАНОВЛЕН');

// Проверяем те же секреты что в коде
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "superrefreshsecret";

console.log('\nИспользуемые секреты:');
console.log('JWT_SECRET:', JWT_SECRET);
console.log('JWT_REFRESH_SECRET:', JWT_REFRESH_SECRET);

// Тестируем токен с этими секретами
const jwt = require('jsonwebtoken');
const browserToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2N2I1ZDg1NWQ0ODk2M2QxMGMxMTVhYzQiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NTk1NTQyOTYsImV4cCI6MTc2MDE1OTA5Nn0.AbYQS1zgLCdrvjSvBJ5zqqDJPzEvLxgI5SrFwy44NA8';

console.log('\n=== ТЕСТ С ИСПОЛЬЗУЕМЫМИ СЕКРЕТАМИ ===');
try {
    const verified = jwt.verify(browserToken, JWT_REFRESH_SECRET);
    console.log('✅ JWT_REFRESH_SECRET РАБОТАЕТ!');
    console.log('Payload:', verified);
} catch (error) {
    console.log('❌ JWT_REFRESH_SECRET не работает:', error.message);
    
    // Попробуем с JWT_SECRET
    try {
        const verified2 = jwt.verify(browserToken, JWT_SECRET);
        console.log('✅ JWT_SECRET РАБОТАЕТ! (но это неправильно)');
        console.log('Payload:', verified2);
    } catch (error2) {
        console.log('❌ JWT_SECRET тоже не работает:', error2.message);
    }
}