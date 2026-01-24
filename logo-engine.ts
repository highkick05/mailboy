import fetch from 'node-fetch';
import { Buffer } from 'buffer';
import fs from 'fs/promises';
import path from 'path';
// 🛑 FIX: Explicit .ts extension for tsx runner
import { redis } from './db';

const CACHE_DIR = path.join(process.cwd(), 'img_cache');
const LOGO_CACHE_DIR = path.join(CACHE_DIR, 'logos');
const REDIS_TTL = 86400; 
export const TRANSPARENT_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

(async () => {
    try {
        await fs.mkdir(LOGO_CACHE_DIR, { recursive: true });
    } catch (e) {}
})();

async function fetchBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url, { 
        signal: AbortSignal.timeout(8000), 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }
    });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length < 500) throw new Error("Image too small");
    return buf;
}

function getRootDomain(domain: string): string | null {
    const parts = domain.split('.');
    if (parts.length <= 2) return null; 
    const isDoubleTLD = parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length <= 2;
    return isDoubleTLD ? (parts.length > 3 ? parts.slice(-3).join('.') : null) : parts.slice(-2).join('.');
}

function generateMonogram(domain: string): Buffer {
    const colors = ['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899'];
    const charCode = domain.charCodeAt(0) + (domain.charCodeAt(1) || 0);
    const color = colors[charCode % colors.length];
    const initials = domain.substring(0, 2).toUpperCase();
    return Buffer.from(`<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" rx="64" fill="${color}"/><text x="50%" y="50%" dy=".1em" fill="white" font-family="Arial, sans-serif" font-size="64" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`);
}

export async function resolveBrandLogo(domain: string, bypassCache = false): Promise<{ data: Buffer, contentType: string, log?: string[] }> {
    const cacheKey = `logo_meta:${domain}`;
    const filePath = path.join(LOGO_CACHE_DIR, `${domain}.png`); 
    const logs: string[] = [];

    if (!bypassCache) {
        const cachedMeta = await redis.get(cacheKey);
        if (cachedMeta) {
            try {
                const { contentType } = JSON.parse(cachedMeta);
                const data = await fs.readFile(filePath);
                if (data.length > 300) return { data, contentType };
            } catch (e) { }
        }
    } else { logs.push(`⚠️ Cache Bypassed`); }

    const rootDomain = getRootDomain(domain);
    const strategies: any[] = [];

    if (process.env.LOGO_DEV_KEY && process.env.LOGO_DEV_KEY.length > 5) {
        strategies.push({ name: 'Logo.dev (Exact)', url: `https://img.logo.dev/${domain}?token=${process.env.LOGO_DEV_KEY}&size=128&format=png` });
        if (rootDomain) strategies.push({ name: 'Logo.dev (Root)', url: `https://img.logo.dev/${rootDomain}?token=${process.env.LOGO_DEV_KEY}&size=128&format=png` });
    }
    strategies.push({ name: 'Google HD', url: `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=128` });
    strategies.push({ name: 'Brandfetch CDN', url: `https://cdn.brandfetch.io/${rootDomain || domain}/w/400/h/400?c=1idKM2-8` });
    strategies.push({ name: 'Unavatar', url: `https://unavatar.io/${domain}?fallback=false` });
    if (rootDomain) strategies.push({ name: 'Unavatar (Root)', url: `https://unavatar.io/${rootDomain}?fallback=false` });
    strategies.push({ name: 'DuckDuckGo', url: `https://icons.duckduckgo.com/ip3/${domain}.ico` });

    for (const strat of strategies) {
        try {
            logs.push(`👉 Trying ${strat.name}...`);
            const buffer = await fetchBuffer(strat.url);
            logs.push(`✅ SUCCESS: ${strat.name}`);
            const contentType = 'image/png'; 
            await fs.writeFile(filePath, buffer);
            await redis.setex(cacheKey, REDIS_TTL * 30, JSON.stringify({ contentType }));
            return { data: buffer, contentType, log: logs };
        } catch (e: any) { logs.push(`❌ Failed ${strat.name}`); }
    }

    logs.push(`🎨 Monogram`);
    const svgBuffer = generateMonogram(rootDomain || domain);
    await fs.writeFile(filePath, svgBuffer);
    await redis.setex(cacheKey, REDIS_TTL * 30, JSON.stringify({ contentType: 'image/svg+xml' }));
    return { data: svgBuffer, contentType: 'image/svg+xml', log: logs };
}

export async function resolveBrandName(domain: string): Promise<string | null> {
    const cacheKey = `brand_name:${domain}`;
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
    if (['gmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'].includes(domain)) return null; 
    try {
        if (!process.env.LOGO_DEV_KEY) return null;
        const response = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(domain)}`, {
            headers: { 'Authorization': `Bearer ${process.env.LOGO_DEV_KEY}` }, signal: AbortSignal.timeout(3000)
        });
        if (response.ok) {
            const data: any = await response.json();
            if (Array.isArray(data) && data.length > 0 && data[0].name) {
                await redis.setex(cacheKey, 86400 * 30, data[0].name);
                return data[0].name;
            }
        }
    } catch (e) { }
    await redis.setex(cacheKey, 3600, '');
    return null;
}