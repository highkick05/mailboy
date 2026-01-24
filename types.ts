// Label Definition
export interface Label {
  id: string;
  name: string;
  color: string;
}

export type EmailFolder = 'Inbox' | 'Sent' | 'Drafts' | 'Trash' | 'Archive' | 'Spam';

export interface Email {
  id: string;
  uid: number;
  from: string;
  senderName: string;
  senderAddr: string;
  to: string;
  subject: string;
  body: string;
  preview: string;
  timestamp: number;
  read: boolean;
  folder: string; 
  labels?: string[];
  isFlagged?: boolean;
  hydrated?: boolean;
  
  // 🛑 NEW: Smart Tab Category
  category?: 'primary' | 'social' | 'updates' | 'promotions'; 
}

export interface MailConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  pass: string;
  useTLS: boolean;
}

// 🛑 NEW: Smart Rule Definition for Settings
export interface SmartRule {
    _id: string;
    category: string;
    type: 'from' | 'subject';
    value: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  latencyMs: number;
  source: 'Redis' | 'IMAP' | 'Edge Gateway' | 'MongoDB';
  protocolLog?: string;
  // Optional stats from worker swarm
  jobsCompleted?: number;
  queue?: { pending: number };
}

export interface SystemState {
  gatewayConnected: boolean;
  redisConnected: boolean;
  mongoConnected: boolean;
}