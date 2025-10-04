// Тест для декодирования JWT токена
const jwt = require('jsonwebtoken');

const browserToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2N2I1ZDg1NWQ0ODk2M2QxMGMxMTVhYzQiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NTk1NTM5ODEsImV4cCI6MTc2MDE1ODc4MX0.69XaViS696va71xfD0RvLyaw5YbPHfuh6nf_JyT3wCc';

console.log('=== JWT ТОКЕН АНАЛИЗ ===');

// Декодируем без проверки подписи
try {
    const decoded = jwt.decode(browserToken);
    console.log('Декодированный токен:');
    console.log('- userId:', decoded.userId);
    console.log('- role:', decoded.role);
    console.log('- iat (issued at):', new Date(decoded.iat * 1000));
    console.log('- exp (expires):', new Date(decoded.exp * 1000));
    console.log('- Текущее время:', new Date());
    console.log('- Токен истек:', decoded.exp * 1000 < Date.now());
} catch (error) {
    console.log('Ошибка декодирования:', error.message);
}

// Пробуем разные секреты
const secrets = [
    'supersecret',
    'superrefreshsecret',
    'secret',
    'refresh_secret'
];

console.log('\n=== ТЕСТ СЕКРЕТОВ ===');
for (const secret of secrets) {
    try {
        const verified = jwt.verify(browserToken, secret);
        console.log(`✅ Секрет "${secret}" РАБОТАЕТ!`);
        console.log('   Payload:', verified);
        break;
    } catch (error) {
        console.log(`❌ Секрет "${secret}": ${error.message}`);
    }
}