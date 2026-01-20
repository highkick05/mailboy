export type EmailFolder = 'Inbox' | 'Sent' | 'Drafts' | 'Trash' | 'Archive' | 'Spam';

export interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  timestamp: number;
  read: boolean;
  folder: EmailFolder;
  tags?: string[];
  isFlagged?: boolean;
  hydrated?: boolean;
  uid?: number;
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

export interface CacheStats {
  hits: number;
  misses: number;
  latencyMs: number;
  source: 'Redis' | 'IMAP' | 'Edge Gateway' | 'MongoDB';
  protocolLog?: string;
}

export interface SystemState {
  gatewayConnected: boolean;
  redisConnected: boolean;
  mongoConnected: boolean;
}