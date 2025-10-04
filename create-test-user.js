// Создаем тестового пользователя с известным паролем
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

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

const createTestUser = async () => {
    await connectDB();
    
    // Проверяем есть ли уже test@test.com
    const existingUser = await User.findOne({ email: 'test@test.com' });
    
    if (existingUser) {
        console.log('Пользователь test@test.com уже существует');
    } else {
        console.log('Создаем тестового пользователя...');
        
        const hashedPassword = await bcrypt.hash('password', 10);
        
        const testUser = new User({
            email: 'test@test.com',
            passwordHash: hashedPassword,
            role: 'admin',
            isApproved: true,
            refreshTokens: []
        });
        
        await testUser.save();
        console.log('✅ Создан пользователь: test@test.com / password');
    }
    
    mongoose.connection.close();
};

createTestUser().catch(console.error);