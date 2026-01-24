import { Email, EmailFolder, CacheStats, MailConfig } from '../types';

class HybridMailService {
  private config: MailConfig | null = null;
  
  // 🛑 FIX: Use relative path so it works on both HTTP (3001) and HTTPS (3002)
  public get API_BASE() {
    return '/api/v1';
  }

  setConfig(config: MailConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return !!this.config;
  }

  async checkBridgeHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.API_BASE}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(2000) 
      });
      return resp.ok;
    } catch { return false; }
  }

  async getSyncStatus(): Promise<any> {
    if (!this.config) return { status: 'IDLE' };
    try {
      const resp = await fetch(`${this.API_BASE}/sync/status?user=${encodeURIComponent(this.config.user)}`);
      if (!resp.ok) return { status: 'IDLE' };
      return resp.json();
    } catch { return { status: 'IDLE' }; }
  }

  // 🛑 ADDED: Missing method required by App.tsx for auto-hydration
  async triggerHydration(): Promise<void> {
    if (!this.config) return;
    try {
      await fetch(`${this.API_BASE}/mail/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.config)
      });
    } catch (e) {
      console.warn("Hydration trigger failed silently", e);
    }
  }

  async fetchRemoteMail(): Promise<{ log: string }> {
    if (!this.config) throw new Error("AUTH_REQUIRED");

    const response = await fetch(`${this.API_BASE}/mail/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.config)
    });

    if (!response.ok) throw new Error('GATEWAY_SYNC_TRIGGER_FAILED');

    return { log: `PIPELINE_INITIATED: Metadata Burst -> Hydration Worker.` };
  }

  async getEmailById(id: string): Promise<{ data: Email | undefined; stats: CacheStats }> {
    if (!this.config) throw new Error("AUTH_REQUIRED");
    
    const start = performance.now();
    const response = await fetch(`${this.API_BASE}/mail/${id}?user=${encodeURIComponent(this.config.user)}`);
    
    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.message || "FETCH_ERROR");
    }
    
    const result = await response.json();
    const duration = performance.now() - start;
    
    return {
      data: result.email,
      stats: {
        hits: result.source === 'Redis' ? 1 : 0,
        misses: result.source !== 'Redis' ? 1 : 0,
        latencyMs: duration,
        source: result.source as 'Redis' | 'MongoDB' | 'IMAP'
      }
    };
  }

  async getAllEmails(folder: EmailFolder = 'Inbox'): Promise<Email[]> {
    if (!this.config) return [];
    try {
      const response = await fetch(`${this.API_BASE}/mail/list?folder=${folder}&user=${encodeURIComponent(this.config.user)}`);
      if (!response.ok) return [];
      return await response.json();
    } catch { return []; }
  }

  // 🛑 NEW: Mark email as Read
  async markAsRead(id: string, user: string): Promise<void> {
    try {
      await fetch(`${this.API_BASE}/mail/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user, read: true })
      });
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  }

  async relaySmtp(email: Omit<Email, 'id' | 'timestamp' | 'read' | 'folder'>): Promise<{ email: Email; log: string }> {
    if (!this.config) throw new Error("AUTH_REQUIRED");
    const response = await fetch(`${this.API_BASE}/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth: this.config, payload: email })
    });
    if (!response.ok) throw new Error("SMTP_RELAY_REJECTED");
    const result = await response.json();
    return { email: result.email, log: `SMTP_SUCCESS: Relay confirmed.` };
  }
}

export const mailService = new HybridMailService();