import mongoose from 'mongoose';
import Redis from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mailboy';

export async function connectDB() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('🍃 MongoDB Persistent Layer Online');
    } catch (err) {
        console.error('MongoDB Connection Error:', err);
        process.exit(1);
    }
}

// 🛑 NEW: User Configuration Schema
const UserConfigSchema = new mongoose.Schema({
    user: { type: String, unique: true, required: true },
    imapHost: String,
    imapPort: Number,
    smtpHost: String,
    smtpPort: Number,
    pass: String, // In production, this should be encrypted!
    useTLS: Boolean,
    setupComplete: { type: Boolean, default: false }, // <--- The Magic Flag
    lastSync: Number
});

export const UserConfigModel = mongoose.model('UserConfig', UserConfigSchema);

const EmailSchema = new mongoose.Schema({
    id: { type: String, unique: true, index: true },
    user: { type: String, index: true },
    uid: Number,
    from: String,
    senderName: String, 
    senderAddr: String,
    to: String,
    subject: String,
    body: { type: String }, 
    preview: { type: String }, 
    isFullBody: { type: Boolean, default: false },
    timestamp: { type: Number, index: true },
    read: Boolean,
    folder: { type: String, index: true }
});

export const EmailModel = mongoose.model('Email', EmailSchema);