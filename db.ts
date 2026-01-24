import mongoose from 'mongoose';
import Redis from 'ioredis';

// 🛑 CRITICAL: Shared Redis connection on Port 6380
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