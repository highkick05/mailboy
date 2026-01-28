import { Email, EmailFolder, CacheStats, MailConfig, Label, SmartRule } from '../types';

class HybridMailService {
  private config: MailConfig | null = null;
  
  // Use relative path so it works on both HTTP (3001) and HTTPS (3002)
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

  // Required by App.tsx for auto-hydration
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
    
    // Handle the 408 Timeout specifically (Worker busy)
    if (response.status === 408) {
        return { 
            data: undefined, 
            stats: { hits: 0, misses: 1, latencyMs: 0, source: 'IMAP' } // Placeholder stats
        };
    }

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

  // 🛑 UPDATED: Support Category Filtering
  async getAllEmails(folder: string | EmailFolder = 'Inbox', category?: string): Promise<Email[]> {
    if (!this.config) return [];
    try {
      // If filtering Inbox, pass category (default to 'primary'). Else 'all'.
      const catParam = (folder === 'Inbox') ? (category || 'primary') : 'all';
      
      const response = await fetch(`${this.API_BASE}/mail/list?folder=${folder}&category=${catParam}&user=${encodeURIComponent(this.config.user)}`);
      if (!response.ok) return [];
      return await response.json();
    } catch { return []; }
  }

  // 🛑 NEW: Smart Rules Management
  async getSmartRules(): Promise<SmartRule[]> {
      if (!this.config) return [];
      try {
        const res = await fetch(`${this.API_BASE}/smart-rules?user=${encodeURIComponent(this.config.user)}`);
        return res.ok ? await res.json() : [];
      } catch { return []; }
  }

  async addSmartRule(category: string, value: string, type: 'from' | 'subject' = 'from'): Promise<SmartRule | null> {
      if (!this.config) return null;
      try {
        const res = await fetch(`${this.API_BASE}/smart-rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: this.config.user, category, value, type })
        });
        return res.ok ? await res.json() : null;
      } catch { return null; }
  }

  async deleteSmartRule(id: string): Promise<boolean> {
      if (!this.config) return false;
      try {
        const res = await fetch(`${this.API_BASE}/smart-rules/${id}?user=${encodeURIComponent(this.config.user)}`, { method: 'DELETE' });
        return res.ok;
      } catch { return false; }
  }

  async markAsRead(id: string, read: boolean): Promise<void> {
    if (!this.config) return;
    await fetch(`${this.API_BASE}/mail/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, read, user: this.config.user })
    });
  }

  async batchMarkRead(ids: string[], read: boolean): Promise<void> {
      if (!this.config || ids.length === 0) return;
      const promises = ids.map(id => this.markAsRead(id, read));
      await Promise.all(promises);
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
  
  // Label Management
  async getLabels(): Promise<Label[]> {
    if (!this.config) return [];
    try {
      const res = await fetch(`${this.API_BASE}/labels?user=${encodeURIComponent(this.config.user)}`);
      return res.ok ? await res.json() : [];
    } catch { return []; }
  }

  async createLabel(name: string, color: string): Promise<Label | null> {
    if (!this.config) return null;
    try {
      const res = await fetch(`${this.API_BASE}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: this.config.user, name, color })
      });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  async deleteLabel(id: string): Promise<boolean> {
    if (!this.config) return false;
    try {
      const res = await fetch(`${this.API_BASE}/labels/${id}?user=${encodeURIComponent(this.config.user)}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch { return false; }
  }

  async toggleLabel(emailId: string, labelId: string, action: 'add' | 'remove'): Promise<void> {
    if (!this.config) return;
    await fetch(`${this.API_BASE}/mail/label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: this.config.user, emailId, labelId, action })
    });
  }
  
  async moveEmail(emailId: string, targetFolder: string): Promise<boolean> {
    if (!this.config) return false;
    try {
      const res = await fetch(`${this.API_BASE}/mail/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            user: this.config.user, 
            emailId, 
            targetFolder 
        })
      });
      return res.ok;
    } catch { return false; }
  }
  
  async deleteEmails(ids: string[]): Promise<void> {
    if (!this.config || ids.length === 0) return;
    const promises = ids.map(id => this.moveEmail(id, 'Trash'));
    await Promise.all(promises);
  }

  // 🛑 NEW: Save Draft
  async saveDraft(to: string, subject: string, body: string, id?: string) {
    if (!this.config) return;
    try {
        await fetch(`${this.API_BASE}/mail/draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                user: this.config.user,
                to,
                subject,
                body,
                id 
            })
        });
    } catch (e) {
        console.error("Failed to save draft:", e);
    }
  }

}

export const mailService = new HybridMailService();