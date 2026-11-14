import fs from 'node:fs';
import path from 'node:path';

export interface ApiKeyRecord {
  apiKey: string;
  uid: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  plan: 'free' | 'pro' | 'admin_unlimited';
  dailyLimit: number; // -1 means unlimited
  requestsToday: number;
  requestsTotal: number;
  usageDate: string;
  status: 'active' | 'suspended';
  lastUsedAt: string | null;
  lastUserAgent: string | null;
}

export interface ApiAccessLog {
  id: string;
  timestamp: string;
  method: string;
  endpoint: string;
  statusCode: number;
  cacheStatus: string;
  userAgent: string;
  apiKeyPrefix: string;
  role: string;
  latencyMs: number;
}

const DATA_DIR = path.resolve('.data');
const REGISTRY_FILE = path.join(DATA_DIR, 'apikey-registry.json');
const ADMIN_EMAIL = 'predimahrobi@gmail.com';
const DEMO_KEY = 'kmk_demo_nusakomik_id_2026';

function getTodayString(): string {
  // Use WIB (UTC+7) date string so Indonesian daily quotas reset cleanly at midnight WIB
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

interface FirebaseConfigFile {
  apiKey: string;
  projectId: string;
}

let cachedFirebaseConfig: FirebaseConfigFile | null = null;

function getFirebaseConfig(): FirebaseConfigFile {
  if (cachedFirebaseConfig) return cachedFirebaseConfig;
  const configPath = path.resolve('firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  cachedFirebaseConfig = JSON.parse(raw) as FirebaseConfigFile;
  return cachedFirebaseConfig;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoUrl: string;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  if (!idToken || idToken.length < 20) return null;
  try {
    const config = getFirebaseConfig();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      users?: Array<{
        localId: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
        photoUrl?: string;
      }>;
    };
    const user = payload.users?.[0];
    if (!user || !user.localId || !user.email) return null;
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName || user.email.split('@')[0],
      photoUrl: user.photoUrl || '',
    };
  } catch {
    return null;
  }
}

class KeyStore {
  private recordsByKey: Map<string, ApiKeyRecord>;
  private keyByUid: Map<string, string>;
  private minuteHits: Map<string, { windowStart: number; count: number }>;
  private logs: ApiAccessLog[];

  constructor() {
    this.recordsByKey = new Map();
    this.keyByUid = new Map();
    this.minuteHits = new Map();
    this.logs = [];
    this.loadFromDisk();
    this.ensureDemoKey();
  }

  private ensureDemoKey(): void {
    if (!this.recordsByKey.has(DEMO_KEY)) {
      const today = getTodayString();
      const demo: ApiKeyRecord = {
        apiKey: DEMO_KEY,
        uid: 'sandbox-demo',
        email: 'sandbox@nusakomik.id',
        displayName: 'Sandbox Demo',
        role: 'user',
        plan: 'free',
        dailyLimit: 250,
        requestsToday: 0,
        requestsTotal: 0,
        usageDate: today,
        status: 'active',
        lastUsedAt: null,
        lastUserAgent: null,
      };
      this.recordsByKey.set(DEMO_KEY, demo);
      this.keyByUid.set(demo.uid, DEMO_KEY);
      this.saveToDisk();
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(REGISTRY_FILE)) return;
      const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
      const list = JSON.parse(raw) as ApiKeyRecord[];
      for (const item of list) {
        if (!item?.apiKey || !item?.uid) continue;
        this.recordsByKey.set(item.apiKey, item);
        this.keyByUid.set(item.uid, item.apiKey);
      }
    } catch {
      // Ignore corrupt file on cold start
    }
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const list = Array.from(this.recordsByKey.values());
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch {
      // Non-fatal in read-only environments
    }
  }

  syncUserRecord(input: {
    uid: string;
    email: string;
    displayName: string;
    apiKey: string;
    role: 'user' | 'admin';
    plan: 'free' | 'pro' | 'admin_unlimited';
    dailyLimit: number;
    status: 'active' | 'suspended';
  }): ApiKeyRecord {
    const today = getTodayString();
    const oldKey = this.keyByUid.get(input.uid);
    let prevRequestsToday = 0;
    let prevRequestsTotal = 0;
    let prevUsageDate = today;
    let prevLastUsed: string | null = null;
    let prevUserAgent: string | null = null;

    if (oldKey) {
      const oldRec = this.recordsByKey.get(oldKey);
      if (oldRec) {
        prevRequestsToday = oldRec.usageDate === today ? oldRec.requestsToday : 0;
        prevRequestsTotal = oldRec.requestsTotal;
        prevUsageDate = today;
        prevLastUsed = oldRec.lastUsedAt;
        prevUserAgent = oldRec.lastUserAgent;
      }
      if (oldKey !== input.apiKey) {
        this.recordsByKey.delete(oldKey);
      }
    }

    const isBootstrappedAdmin = input.email.toLowerCase() === ADMIN_EMAIL;
    const role: 'user' | 'admin' = isBootstrappedAdmin ? 'admin' : input.role;
    const plan: 'free' | 'pro' | 'admin_unlimited' = isBootstrappedAdmin ? 'admin_unlimited' : input.plan;
    const dailyLimit = role === 'admin' ? -1 : input.dailyLimit;

    const record: ApiKeyRecord = {
      apiKey: input.apiKey,
      uid: input.uid,
      email: input.email,
      displayName: input.displayName,
      role,
      plan,
      dailyLimit,
      requestsToday: prevRequestsToday,
      requestsTotal: prevRequestsTotal,
      usageDate: prevUsageDate,
      status: input.status,
      lastUsedAt: prevLastUsed,
      lastUserAgent: prevUserAgent,
    };

    this.recordsByKey.set(input.apiKey, record);
    this.keyByUid.set(input.uid, input.apiKey);
    this.saveToDisk();
    return record;
  }

  getByUid(uid: string): ApiKeyRecord | null {
    const key = this.keyByUid.get(uid);
    if (!key) return null;
    const rec = this.recordsByKey.get(key) ?? null;
    if (rec && rec.usageDate !== getTodayString()) {
      rec.requestsToday = 0;
      rec.usageDate = getTodayString();
      this.saveToDisk();
    }
    return rec;
  }

  getAllRecords(): ApiKeyRecord[] {
    return Array.from(this.recordsByKey.values()).filter((r) => r.uid !== 'sandbox-demo');
  }

  validateAndConsume(
    apiKey: string,
    userAgent: string
  ): {
    allowed: boolean;
    statusCode: number;
    error?: string;
    record?: ApiKeyRecord;
    remaining: string;
  } {
    const record = this.recordsByKey.get(apiKey);
    if (!record) {
      return {
        allowed: false,
        statusCode: 401,
        error: 'API Key tidak valid atau belum tersinkronisasi. Masuk via Google OAuth untuk mendapatkan API Key aktif.',
        remaining: '0',
      };
    }

    if (record.status === 'suspended') {
      return {
        allowed: false,
        statusCode: 403,
        error: 'API Key Anda sedang dinonaktifkan oleh administrator.',
        remaining: '0',
      };
    }

    const today = getTodayString();
    if (record.usageDate !== today) {
      record.usageDate = today;
      record.requestsToday = 0;
    }

    // Admin has unlimited daily and per-minute quota
    if (record.role === 'admin' || record.dailyLimit === -1) {
      record.requestsToday += 1;
      record.requestsTotal += 1;
      record.lastUsedAt = new Date().toISOString();
      record.lastUserAgent = userAgent.slice(0, 120);
      this.saveToDisk();
      return {
        allowed: true,
        statusCode: 200,
        record,
        remaining: 'unlimited',
      };
    }

    // Per-minute burst guard (60 req/min for non-admin)
    const now = Date.now();
    const minuteState = this.minuteHits.get(apiKey);
    if (!minuteState || now - minuteState.windowStart > 60_000) {
      this.minuteHits.set(apiKey, { windowStart: now, count: 1 });
    } else {
      if (minuteState.count >= 60) {
        return {
          allowed: false,
          statusCode: 429,
          error: 'Batas burst 60 request/menit tercapai. Tunggu beberapa detik atau gunakan caching di sisi klien.',
          remaining: '0',
        };
      }
      minuteState.count += 1;
    }

    if (record.requestsToday >= record.dailyLimit) {
      return {
        allowed: false,
        statusCode: 429,
        error: `Kuota harian (${record.dailyLimit} request/hari) telah habis. Upgrade ke Pro atau tunggu reset harian.`,
        remaining: '0',
      };
    }

    record.requestsToday += 1;
    record.requestsTotal += 1;
    record.lastUsedAt = new Date().toISOString();
    record.lastUserAgent = userAgent.slice(0, 120);
    this.saveToDisk();

    return {
      allowed: true,
      statusCode: 200,
      record,
      remaining: String(Math.max(0, record.dailyLimit - record.requestsToday)),
    };
  }

  recordLog(log: Omit<ApiAccessLog, 'id' | 'timestamp'>): void {
    this.logs.unshift({
      ...log,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    });
    if (this.logs.length > 50) {
      this.logs.length = 50;
    }
  }

  getLogs(): ApiAccessLog[] {
    return this.logs;
  }
}

export const keyStore = new KeyStore();
export const ADMIN_BOOTSTRAP_EMAIL = ADMIN_EMAIL;
export const DEMO_SANDBOX_KEY = DEMO_KEY;
