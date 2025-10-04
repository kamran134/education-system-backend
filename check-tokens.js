// Проверим токены в базе данных
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

const checkTokens = async () => {
    await connectDB();
    
    const adminUser = await User.findOne({ email: 'admin@admin.com' });
    
    if (adminUser) {
        console.log('Пользователь admin@admin.com найден:');
        console.log('- ID:', adminUser._id);
        console.log('- Approved:', adminUser.isApproved);
        console.log('- Refresh tokens count:', adminUser.refreshTokens.length);
        
        if (adminUser.refreshTokens.length > 0) {
            console.log('- Последний токен (первые 50 символов):', adminUser.refreshTokens[adminUser.refreshTokens.length - 1].substring(0, 50) + '...');
        }
        
        // Проверим наш токен из браузера
        const browserToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2N2I1ZDg1NWQ0ODk2M2QxMGMxMTVhYzQiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NTk1NTI4MzksImV4cCI6MTc2MDE1NzYzOX0.wG6Fco20q98BsXsZ3r_a8mOLLstu2t4B9TYUyJvLOBc';
        
        const hasToken = adminUser.refreshTokens.includes(browserToken);
        console.log('- Токен из браузера найден в базе:', hasToken);
        
        if (!hasToken && adminUser.refreshTokens.length > 0) {
            console.log('- Сравним токены:');
            console.log('  Браузер   :', browserToken.substring(0, 50) + '...');
            console.log('  Последний :', adminUser.refreshTokens[adminUser.refreshTokens.length - 1].substring(0, 50) + '...');
        }
    } else {
        console.log('Пользователь admin@admin.com не найден');
    }
    
    mongoose.connection.close();
};

checkTokens().catch(console.error);