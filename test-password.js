// Проверяем пароль для admin@admin.com
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

const checkPassword = async () => {
    await connectDB();
    
    // Проверим всех пользователей
    const users = await User.find({});
    console.log('Все пользователи:');
    users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.email} (${user.role}) - Approved: ${user.isApproved}`);
    });
    
    const adminUser = await User.findOne({ email: 'admin@admin.com' });
    
    if (adminUser) {
        console.log('Проверяем пароли для admin@admin.com:');
        
        const passwords = ['admin', 'password', '123456', 'admin123'];
        
        for (const pwd of passwords) {
            const isValid = await bcrypt.compare(pwd, adminUser.passwordHash);
            console.log(`- "${pwd}": ${isValid ? '✅ ПРАВИЛЬНЫЙ' : '❌ неправильный'}`);
        }
        
        // Также покажем hash
        console.log('\nHash в базе:', adminUser.passwordHash.substring(0, 20) + '...');
        
    } else {
        console.log('Пользователь admin@admin.com не найден');
    }
    
    mongoose.connection.close();
};

checkPassword().catch(console.error);