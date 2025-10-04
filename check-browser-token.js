// Проверяем токен из браузера
require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB подключена');
};

const userSchema = new mongoose.Schema({
    email: String,
    passwordHash: String,
    role: String,
    isApproved: Boolean,
    refreshTokens: [String]
});

const User = mongoose.model('User', userSchema);

const checkBrowserToken = async () => {
    await connectDB();
    
    // Токен из curl теста 
    const browserToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2N2I1ZDg1NWQ0ODk2M2QxMGMxMTVhYzQiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NTk1NTQ1NjQsImV4cCI6MTc2MDE1OTM2NH0.Puo2Kf4tYNQ8auwW17u-smllyTl4qOTei5sMTqLH5hQ';
    
    const adminUser = await User.findOne({ email: 'admin@admin.com' });
    
    if (adminUser) {
        console.log(`Найдено токенов в базе: ${adminUser.refreshTokens.length}`);
        
        const hasToken = adminUser.refreshTokens.includes(browserToken);
        console.log(`Токен из браузера найден в базе: ${hasToken ? '✅ ДА' : '❌ НЕТ'}`);
        
        if (hasToken) {
            console.log('🎉 Отлично! Токен валидный.');
        } else {
            console.log('Сравним токены:');
            console.log('Браузер:', browserToken.substring(0, 50) + '...');
            adminUser.refreshTokens.forEach((token, index) => {
                console.log(`База ${index + 1}:`, token.substring(0, 50) + '...');
            });
        }
    }
    
    mongoose.connection.close();
};

checkBrowserToken().catch(console.error);