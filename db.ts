import mongoose from 'mongoose';
import Redis from 'ioredis';

// 1. Redis Connection
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
redis.on('error', (err) => console.error('Redis Client Error', err));

// 2. MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mailboy');
    console.log('📦 MongoDB Connected');
  } catch (err) {
    console.error('MongoDB Connection Error:', err);
    process.exit(1);
  }
};

// 🛑 NEW: Attachment Schema (Metadata only - files live on disk)
const AttachmentSchema = new mongoose.Schema({
  filename: String,
  path: String,      // Relative path on disk (e.g., "171542384-report.pdf")
  size: Number,      // Size in bytes
  mimeType: String,  // e.g., "application/pdf"
  cid: String        // Content-ID for inline images
});

// 3. Email Schema (Updated with 'category' and 'attachments')
const EmailSchema = new mongoose.Schema({
  id: { type: String, unique: true }, // Composite: uid-folder
  uid: { type: Number },
  user: { type: String, index: true },
  from: String,
  senderName: String,
  senderAddr: String,
  to: String,
  subject: String,
  body: String,
  preview: String,
  timestamp: Number,
  isFullBody: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  folder: { type: String, index: true },
  labels: { type: [String], default: [] },
  
  // Smart Tab Category ('primary', 'social', 'updates', 'promotions')
  category: { type: String, default: 'primary', index: true },

  // 🛑 NEW: Attachments Array
  attachments: [AttachmentSchema] 
});
// Compound index for efficient list fetching
EmailSchema.index({ user: 1, folder: 1, timestamp: -1 });

// 4. User Config Schema
const UserConfigSchema = new mongoose.Schema({
  user: { type: String, unique: true },
  pass: String,
  imapHost: String,
  imapPort: Number,
  smtpHost: String,
  smtpPort: Number,
  useTLS: Boolean,
  setupComplete: { type: Boolean, default: false },
  lastSync: Number
});

// 5. Label Definition Schema
const LabelSchema = new mongoose.Schema({
  id: { type: String, unique: true }, // e.g., "work", "travel"
  user: { type: String, index: true },
  name: { type: String },
  color: { type: String }, // Tailwind class e.g., "bg-red-500"
  created: { type: Number, default: Date.now }
});

// 6. Smart Rule Schema (For Keyword Learning)
const SmartRuleSchema = new mongoose.Schema({
    user: { type: String, required: true, index: true },
    category: { type: String, required: true }, // 'primary', 'social', 'updates', 'promotions'
    type: { type: String, default: 'from' },    // 'from' or 'subject'
    value: { type: String, required: true }      // e.g. 'twitter.com', 'newsletter'
});
// Compound index to prevent duplicates
SmartRuleSchema.index({ user: 1, category: 1, value: 1 }, { unique: true });

const EmailModel = mongoose.model('Email', EmailSchema);
const UserConfigModel = mongoose.model('UserConfig', UserConfigSchema);
const LabelModel = mongoose.model('Label', LabelSchema);
const SmartRuleModel = mongoose.model('SmartRule', SmartRuleSchema);

export { redis, connectDB, EmailModel, UserConfigModel, LabelModel, SmartRuleModel };