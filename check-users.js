// Скрипт для проверки пользователей в базе
require('dotenv').config();
const mongoose = require('mongoose');

// Подключаемся к базе данных
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/education-system');
        console.log('MongoDB подключена');
    } catch (error) {
        console.error('Ошибка подключения к MongoDB:', error);
        process.exit(1);
    }
};

// Схема пользователя (упрощенная)
const userSchema = new mongoose.Schema({
    email: String,
    passwordHash: String,
    role: String,
    isApproved: Boolean,
    refreshTokens: [String]
});

const User = mongoose.model('User', userSchema);

const checkUsers = async () => {
    await connectDB();
    
    const users = await User.find({});
    console.log(`\nНайдено ${users.length} пользователей:`);
    
    users.forEach((user, index) => {
        console.log(`${index + 1}. Email: ${user.email}, Role: ${user.role}, Approved: ${user.isApproved}`);
    });
    
    if (users.length === 0) {
        console.log('\nПользователи не найдены. Создаем тестового пользователя...');
        
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('password', 10);
        
        const testUser = new User({
            email: 'test@test.com',
            passwordHash: hashedPassword,
            role: 'admin',
            isApproved: true,
            refreshTokens: []
        });
        
        await testUser.save();
        console.log('Тестовый пользователь создан: test@test.com / password');
    }
    
    mongoose.connection.close();
};

checkUsers().catch(console.error);