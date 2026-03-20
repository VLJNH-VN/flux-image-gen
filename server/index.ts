import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { scheduleBackup, runBackup, restoreFromGitHub } from "./backup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Trên Render: dùng PORT (1 port duy nhất cho cả API + static)
// Trên Replit dev: dùng API_SERVER_PORT riêng
const API_PORT = IS_PRODUCTION
  ? Number(process.env.PORT || 3000)
  : Number(process.env.API_SERVER_PORT || 5001);

const app = express();

// Tự tạo thư mục data nếu chưa có
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());

// ── Gemini AI ──────────────────────────────────────────────────────────────
// Replit: dùng AI_INTEGRATIONS_GEMINI_BASE_URL + AI_INTEGRATIONS_GEMINI_API_KEY
// Render: dùng GEMINI_API_KEY trực tiếp
const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const geminiApiKey =
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  "dummy";

const ai = geminiBaseUrl
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: { apiVersion: "", baseUrl: geminiBaseUrl },
    })
  : process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: geminiApiKey })
  : null;

// ── Quota ──────────────────────────────────────────────────────────────────
const FREE_DAILY_QUOTA = 50;

// ── CF Credential pool ─────────────────────────────────────────────────────
const CREDS_FILE = path.join(__dirname, "data", "credentials.json");

interface CFAccount {
  label: string;
  accountId: string;
  token: string;
  dailyUsage: number;
  lastReset: string;
  exhausted: boolean;
}

interface CredsDB {
  currentIndex: number;
  adminKey: string;
  accounts: CFAccount[];
}

// Lấy admin key: ưu tiên biến môi trường ADMIN_KEY, fallback sang key lưu trong file
function getAdminKey(): string {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  return loadCreds().adminKey;
}

function loadCreds(): CredsDB {
  try {
    const data = JSON.parse(fs.readFileSync(CREDS_FILE, "utf-8"));
    if (!data.adminKey) {
      data.adminKey = "ADMIN-" + crypto.randomBytes(16).toString("hex").toUpperCase();
      fs.writeFileSync(CREDS_FILE, JSON.stringify(data, null, 2));
    }
    return data;
  } catch {
    const adminKey = "ADMIN-" + crypto.randomBytes(16).toString("hex").toUpperCase();
    const fresh: CredsDB = { currentIndex: 0, adminKey, accounts: [] };
    fs.writeFileSync(CREDS_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveCreds(db: CredsDB): void {
  fs.writeFileSync(CREDS_FILE, JSON.stringify(db, null, 2));
}

// Middleware kiểm tra admin key
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const provided = req.headers["x-admin-key"] as string || req.query.adminKey as string;
  if (!provided || provided !== getAdminKey()) {
    res.status(403).json({ error: "❌ Không có quyền. Cần Admin Key hợp lệ trong header X-Admin-Key" });
    return;
  }
  next();
}

function resetCredIfNeeded(acc: CFAccount): CFAccount {
  if (acc.lastReset !== new Date().toISOString().slice(0, 10)) {
    acc.dailyUsage = 0;
    acc.lastReset = new Date().toISOString().slice(0, 10);
    acc.exhausted = false;
  }
  return acc;
}

// Lấy credential đang hoạt động, xoay vòng nếu hết quota
function getActiveCred(): CFAccount | null {
  const db = loadCreds();
  if (!db.accounts.length) return null;

  // Reset quota ngày mới cho tất cả accounts
  db.accounts = db.accounts.map(resetCredIfNeeded);

  // Tìm account chưa exhausted bắt đầu từ currentIndex
  for (let i = 0; i < db.accounts.length; i++) {
    const idx = (db.currentIndex + i) % db.accounts.length;
    if (!db.accounts[idx].exhausted) {
      db.currentIndex = idx;
      saveCreds(db);
      return db.accounts[idx];
    }
  }
  return null; // Tất cả đã hết
}

// Đánh dấu credential hiện tại đã hết quota và chuyển sang cái tiếp theo
function exhaustCurrentCred(): void {
  const db = loadCreds();
  if (!db.accounts.length) return;
  db.accounts[db.currentIndex].exhausted = true;
  // Chuyển sang cái tiếp theo
  db.currentIndex = (db.currentIndex + 1) % db.accounts.length;
  saveCreds(db);
}

// ── Key data store ─────────────────────────────────────────────────────────
const KEYS_FILE = path.join(__dirname, "data", "keys.json");

interface UserData {
  key: string;
  keyShown: boolean;
  type: "free" | "vip";
  ip: string;
  cfAccountId: string;
  cfToken: string;
  dailyUsage: number;
  lastReset: string;
  registeredAt: string;
}

interface KeysDB {
  users: Record<string, UserData>; // key = ip hash
}

// ── IP helpers ─────────────────────────────────────────────────────────────
function getClientIP(req: express.Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])
    || req.socket.remoteAddress
    || "unknown";
  return ip.trim().replace("::ffff:", "");
}

function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function loadDB(): KeysDB {
  try {
    const data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8"));
    if (!data.users || typeof data.users !== "object") {
      data.users = {};
    }
    return data;
  } catch {
    return { users: {} };
  }
}

function saveDB(db: KeysDB): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(db, null, 2), "utf-8");
}

function generateKey(): string {
  const part = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FLUX-${part()}-${part()}-${part()}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetQuotaIfNeeded(user: UserData): UserData {
  if (user.lastReset !== today()) {
    user.dailyUsage = 0;
    user.lastReset = today();
  }
  return user;
}

function findUserByKey(db: KeysDB, key: string): [string | null, UserData | null] {
  for (const [id, u] of Object.entries(db.users)) {
    if (u.key === key) return [id, u];
  }
  return [null, null];
}

// Lấy hoặc tạo user theo IP (tự động cấp key free lần đầu)
function getOrCreateUserByIP(db: KeysDB, ip: string): [string, UserData, boolean] {
  const ipId = hashIP(ip);
  const isNew = !db.users[ipId];
  if (isNew) {
    db.users[ipId] = {
      key: generateKey(),
      keyShown: false,
      type: "free",
      ip,
      cfAccountId: "",
      cfToken: "",
      dailyUsage: 0,
      lastReset: today(),
      registeredAt: new Date().toISOString(),
    };
  }
  return [ipId, db.users[ipId], isNew];
}

// ── Cloudflare helpers ─────────────────────────────────────────────────────
async function verifyCF(accountId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

async function callCFOnce(
  accountId: string,
  token: string,
  prompt: string,
  width: number,
  height: number,
  steps: number
): Promise<{ image: string; mimeType: string } | { quota: true }> {
  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, num_steps: steps, width, height }),
    }
  );

  // 429 hoặc lỗi quota → báo cần xoay vòng
  if (cfRes.status === 429) return { quota: true };

  if (!cfRes.ok) {
    const errText = await cfRes.text();
    // Một số lỗi quota trả về 400 với message cụ thể
    if (errText.includes("exceeded") || errText.includes("quota") || errText.includes("limit")) {
      return { quota: true };
    }
    throw new Error(`Cloudflare API lỗi ${cfRes.status}: ${errText}`);
  }

  const contentType = cfRes.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await cfRes.json() as { result?: { image?: string }; errors?: Array<{ message: string }> };
    if (data.result?.image) return { image: data.result.image, mimeType: "image/png" };
    const errMsg = data.errors?.[0]?.message || "";
    if (errMsg.includes("exceeded") || errMsg.includes("quota") || errMsg.includes("limit")) {
      return { quota: true };
    }
    throw new Error(errMsg || "Không nhận được ảnh từ Cloudflare");
  }

  const buf = await cfRes.arrayBuffer();
  return { image: Buffer.from(buf).toString("base64"), mimeType: "image/png" };
}

// Tạo ảnh với tự động xoay vòng credentials khi hết quota
async function generateImageCF(
  prompt: string,
  preferredAccountId?: string,
  preferredToken?: string,
  width = 1024,
  height = 1024,
  steps = 4
): Promise<{ image: string; mimeType: string }> {
  // VIP user dùng credentials riêng (không xoay vòng)
  if (preferredAccountId && preferredToken) {
    const result = await callCFOnce(preferredAccountId, preferredToken, prompt, width, height, steps);
    if ("quota" in result) throw new Error("Token VIP của bạn đã hết quota hoặc không hợp lệ. Vui lòng cập nhật tại /api/key/vip");
    return result;
  }

  // Free user → thử lần lượt từng credential trong pool
  const db = loadCreds();
  db.accounts = db.accounts.map(resetCredIfNeeded);
  saveCreds(db);

  const tried = new Set<number>();
  let startIdx = db.currentIndex;

  for (let i = 0; i < db.accounts.length; i++) {
    const idx = (startIdx + i) % db.accounts.length;
    if (tried.has(idx)) continue;
    const acc = db.accounts[idx];
    if (acc.exhausted) continue;

    tried.add(idx);

    try {
      const result = await callCFOnce(acc.accountId, acc.token, prompt, width, height, steps);

      if ("quota" in result) {
        // Hết quota → đánh dấu và sang cái tiếp
        console.log(`[CF Rotate] Account "${acc.label}" hết quota → chuyển sang tiếp theo`);
        db.accounts[idx].exhausted = true;
        db.currentIndex = (idx + 1) % db.accounts.length;
        saveCreds(db);
        startIdx = db.currentIndex;
        continue;
      }

      // Thành công → tăng usage
      db.accounts[idx].dailyUsage++;
      db.currentIndex = idx;
      saveCreds(db);
      return result;
    } catch (err) {
      throw err;
    }
  }

  throw new Error("Tất cả CF accounts đã hết quota hôm nay. Vui lòng thêm account mới qua /api/admin/credentials hoặc chờ ngày mai.");
}

// ── Styles & Sizes ─────────────────────────────────────────────────────────
const STYLES = [
  { value: "", label: "Tự động" },
  { value: "photorealistic", label: "Ảnh thực tế" },
  { value: "digital art", label: "Nghệ thuật số" },
  { value: "anime", label: "Anime" },
  { value: "oil painting", label: "Tranh sơn dầu" },
  { value: "watercolor", label: "Màu nước" },
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "fantasy art", label: "Fantasy" },
  { value: "minimalist", label: "Tối giản" },
  { value: "3D render", label: "3D Render" },
  { value: "sketch", label: "Phác thảo" },
  { value: "cinematic", label: "Điện ảnh" },
];

const SIZES = [
  { label: "Vuông 1:1", width: 1024, height: 1024 },
  { label: "Ngang 16:9", width: 1360, height: 768 },
  { label: "Dọc 9:16", width: 768, height: 1360 },
  { label: "Ngang 4:3", width: 1024, height: 768 },
  { label: "Dọc 3:4", width: 768, height: 1024 },
];

// ══════════════════════════════════════════════════════════════════════════════
//  KEY ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/key/register — tạo hoặc lấy lại key free theo IP
app.post("/api/key/register", (req, res) => {
  const ip = getClientIP(req);
  const db = loadDB();
  const [ipId, user] = getOrCreateUserByIP(db, ip);

  const u = resetQuotaIfNeeded(user);
  u.keyShown = true;
  db.users[ipId] = u;
  saveDB(db);

  res.json({
    success: true,
    key: u.key,
    type: u.type,
    ip: ip,
    quota: u.type === "free"
      ? `${u.dailyUsage}/${FREE_DAILY_QUOTA} hôm nay`
      : "VIP — không giới hạn",
  });
});

// POST /api/key/vip — nâng cấp VIP bằng CF credentials
app.post("/api/key/vip", async (req, res) => {
  const { key, cfAccountId, cfToken } = req.body as {
    key: string;
    cfAccountId: string;
    cfToken: string;
  };

  if (!key || !cfAccountId || !cfToken) {
    res.status(400).json({ error: "Thiếu key, cfAccountId hoặc cfToken" });
    return;
  }

  const db = loadDB();
  const [userId, user] = findUserByKey(db, key);

  if (!userId || !user) {
    res.status(404).json({ error: "Key không hợp lệ. Vui lòng đăng ký trước." });
    return;
  }

  const alive = await verifyCF(cfAccountId, cfToken);

  if (!alive) {
    res.status(400).json({
      error: "❌ Token hoặc Account ID Cloudflare không hợp lệ (đã chết). Vui lòng kiểm tra lại và thêm token mới.",
      tip: "Tạo token tại: https://dash.cloudflare.com/profile/api-tokens → Workers AI",
    });
    return;
  }

  // Lưu vào keys.json (user record)
  const newKey = generateKey();
  user.key = newKey;
  user.keyShown = true;
  user.type = "vip";
  user.cfAccountId = cfAccountId;
  user.cfToken = cfToken;
  db.users[userId] = user;
  saveDB(db);

  // Cũng thêm vào credentials.json pool để xoay vòng
  const credsDb = loadCreds();
  const existingIdx = credsDb.accounts.findIndex(a => a.accountId === cfAccountId && a.token === cfToken);
  if (existingIdx === -1) {
    credsDb.accounts.push({
      label: `VIP-${userId.slice(0, 8)}`,
      accountId: cfAccountId,
      token: cfToken,
      dailyUsage: 0,
      lastReset: today(),
      exhausted: false,
    });
    saveCreds(credsDb);
  }

  res.json({
    success: true,
    key: newKey,
    type: "vip",
    status: "✅ Token Cloudflare hợp lệ (đang sống)",
    addedToPool: existingIdx === -1,
    note: "Key VIP đã được lưu. Dùng /api/key/info để xem lại bất cứ lúc nào.",
  });
});

// GET /api/key/info — xem thông tin key (free & VIP, luôn hiển thị key)
// Hỗ trợ: ?key=xxx (tra theo key) hoặc không truyền gì (tra theo IP)
app.get("/api/key/info", (req, res) => {
  const db = loadDB();
  let user: UserData | null = null;

  const queryKey = req.query.key as string | undefined;
  if (queryKey) {
    const [, found] = findUserByKey(db, queryKey);
    user = found;
    if (!user) {
      res.status(404).json({ error: "Key không tồn tại" });
      return;
    }
  } else {
    const ip = getClientIP(req);
    const [ipId, found] = getOrCreateUserByIP(db, ip);
    found.keyShown = true;
    db.users[ipId] = found;
    saveDB(db);
    user = found;
  }

  const u = resetQuotaIfNeeded(user);
  res.json({
    key: u.key,
    type: u.type,
    registeredAt: u.registeredAt,
    quota: {
      used: u.dailyUsage,
      limit: u.type === "free" ? FREE_DAILY_QUOTA : "không giới hạn",
      remaining: u.type === "free" ? Math.max(0, FREE_DAILY_QUOTA - u.dailyUsage) : "không giới hạn",
    },
    cfStatus: u.type === "vip" ? "configured" : "using pool",
  });
});

// POST /api/key/check-cf — kiểm tra CF token còn sống không
app.post("/api/key/check-cf", async (req, res) => {
  const { key } = req.body as { key: string };
  if (!key) {
    res.status(400).json({ error: "Thiếu key" });
    return;
  }

  const db = loadDB();
  const [, user] = findUserByKey(db, key);

  if (!user || user.type !== "vip") {
    res.status(403).json({ error: "Chỉ tài khoản VIP mới có thể kiểm tra CF token" });
    return;
  }

  const alive = await verifyCF(user.cfAccountId, user.cfToken);
  res.json({
    alive,
    status: alive ? "✅ Token đang sống — hoạt động bình thường" : "❌ Token đã chết — vui lòng cập nhật tại /api/key/vip",
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  INFO ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", gemini: !!ai, cloudflare: true, timestamp: new Date().toISOString() });
});

app.get("/api/styles", (_req, res) => res.json({ styles: STYLES }));
app.get("/api/sizes", (_req, res) => res.json({ sizes: SIZES }));

// ══════════════════════════════════════════════════════════════════════════════
//  GENERATE ENDPOINTS (yêu cầu key)
// ══════════════════════════════════════════════════════════════════════════════

// Helper: resolve user từ key hoặc IP, kiểm tra quota
function resolveUser(
  req: express.Request,
  key: string | undefined
): { ok: boolean; error?: string; vipAccountId?: string; vipToken?: string; db?: KeysDB; ipId?: string; user?: UserData } {
  const db = loadDB();
  let ipId: string;
  let user: UserData;

  if (key) {
    const [foundId, foundUser] = findUserByKey(db, key);
    if (!foundId || !foundUser) {
      return { ok: false, error: "Key không hợp lệ. Đăng ký tại POST /api/key/register" };
    }
    ipId = foundId;
    user = foundUser;
  } else {
    const ip = getClientIP(req);
    const [id, u] = getOrCreateUserByIP(db, ip);
    ipId = id;
    user = u;
  }

  const u = resetQuotaIfNeeded(user);
  if (u.type === "free" && u.dailyUsage >= FREE_DAILY_QUOTA) {
    return { ok: false, error: `Đã dùng hết ${FREE_DAILY_QUOTA} ảnh/ngày. Nâng cấp VIP hoặc thêm CF token của bạn.` };
  }

  // VIP → trả về credentials riêng; free → undefined (pool tự xử lý)
  return {
    ok: true,
    vipAccountId: u.type === "vip" && u.cfAccountId ? u.cfAccountId : undefined,
    vipToken: u.type === "vip" && u.cfToken ? u.cfToken : undefined,
    db,
    ipId,
    user: u,
  };
}

// POST /api/generate-prompt
app.post("/api/generate-prompt", async (req, res) => {
  const { idea, style, key } = req.body as { idea: string; style?: string; key?: string };

  if (!idea) {
    res.status(400).json({ error: "Thiếu ý tưởng (idea)" });
    return;
  }

  if (!ai) {
    res.status(500).json({ error: "Gemini AI chưa được cấu hình" });
    return;
  }

  // Kiểm tra key / IP & quota
  const resolved = resolveUser(req, key);
  if (!resolved.ok) {
    res.status(resolved.error?.includes("hết") ? 429 : 403).json({ error: resolved.error });
    return;
  }

  try {
    const styleHint = style ? `, artistic style: ${style}` : "";
    const systemPrompt = `You are an expert AI image prompt engineer for Flux image generation models.
Your task: Convert the user's idea into a detailed, professional English prompt for Flux Image AI.

Rules:
- Write ENTIRELY in English
- Describe in detail: lighting, colors, camera angle, artistic style, quality
- Add quality keywords: "highly detailed", "8K resolution", "masterpiece", "professional photography"
- Return ONLY the prompt text, no explanations or commentary
- Length: 50-150 words`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { systemInstruction: systemPrompt, maxOutputTokens: 512 },
      contents: [{ role: "user", parts: [{ text: `Create a Flux image prompt for this idea: "${idea}"${styleHint}` }] }],
    });

    const prompt = response.text?.trim() || "";
    res.json({ prompt });
  } catch (err: unknown) {
    console.error("Gemini error:", err);
    res.status(500).json({ error: "Lỗi tạo prompt: " + (err as Error).message });
  }
});

// POST /api/generate-image
app.post("/api/generate-image", async (req, res) => {
  const { prompt, width, height, steps, key } = req.body as {
    prompt: string;
    width?: number;
    height?: number;
    steps?: number;
    key?: string;
  };

  if (!prompt) {
    res.status(400).json({ error: "Thiếu prompt" });
    return;
  }

  const resolved = resolveUser(req, key);
  if (!resolved.ok) {
    res.status(resolved.error?.includes("hết") ? 429 : 403).json({ error: resolved.error });
    return;
  }

  // Tăng quota
  if (resolved.db && resolved.ipId && resolved.user) {
    resolved.user.dailyUsage++;
    resolved.db.users[resolved.ipId] = resolved.user;
    saveDB(resolved.db);
  }

  try {
    const result = await generateImageCF(prompt, resolved.vipAccountId, resolved.vipToken, width, height, steps);
    res.json(result);
  } catch (err: unknown) {
    console.error("Cloudflare error:", err);
    res.status(500).json({ error: "Lỗi tạo ảnh: " + (err as Error).message });
  }
});

// POST /api/generate-all
app.post("/api/generate-all", async (req, res) => {
  const { idea, style, width, height, steps, key } = req.body as {
    idea: string;
    style?: string;
    width?: number;
    height?: number;
    steps?: number;
    key?: string;
  };

  if (!idea) {
    res.status(400).json({ error: "Thiếu ý tưởng (idea)" });
    return;
  }

  if (!ai) {
    res.status(500).json({ error: "Gemini AI chưa được cấu hình" });
    return;
  }

  const resolved = resolveUser(req, key);
  if (!resolved.ok) {
    res.status(resolved.error?.includes("hết") ? 429 : 403).json({ error: resolved.error });
    return;
  }

  // Tăng quota
  if (resolved.db && resolved.ipId && resolved.user) {
    resolved.user.dailyUsage++;
    resolved.db.users[resolved.ipId] = resolved.user;
    saveDB(resolved.db);
  }

  try {
    const styleHint = style ? `, artistic style: ${style}` : "";
    const systemPrompt = `You are an expert AI image prompt engineer for Flux image generation models.
Your task: Convert the user's idea into a detailed, professional English prompt for Flux Image AI.

Rules:
- Write ENTIRELY in English
- Describe in detail: lighting, colors, camera angle, artistic style, quality
- Add quality keywords: "highly detailed", "8K resolution", "masterpiece", "professional photography"
- Return ONLY the prompt text, no explanations or commentary
- Length: 50-150 words`;

    const promptResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { systemInstruction: systemPrompt, maxOutputTokens: 512 },
      contents: [{ role: "user", parts: [{ text: `Create a Flux image prompt for this idea: "${idea}"${styleHint}` }] }],
    });

    const generatedPrompt = promptResponse.text?.trim() || idea;
    const result = await generateImageCF(generatedPrompt, resolved.vipAccountId, resolved.vipToken, width, height, steps);

    res.json({ prompt: generatedPrompt, ...result });
  } catch (err: unknown) {
    console.error("generate-all error:", err);
    res.status(500).json({ error: "Lỗi: " + (err as Error).message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS — quản lý CF credentials pool
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/me — thông tin user theo IP (key, quota, loại)
app.get("/api/me", (req, res) => {
  const ip = getClientIP(req);
  const db = loadDB();
  const [ipId, user] = getOrCreateUserByIP(db, ip);
  const u = resetQuotaIfNeeded(user);
  u.keyShown = true;
  db.users[ipId] = u;
  saveDB(db);
  res.json({
    ip,
    key: u.key,
    type: u.type,
    quota: u.type === "free"
      ? { used: u.dailyUsage, limit: FREE_DAILY_QUOTA, remaining: Math.max(0, FREE_DAILY_QUOTA - u.dailyUsage) }
      : { used: u.dailyUsage, limit: "không giới hạn" },
  });
});

// GET /api/admin/credentials — xem danh sách (token ẩn bớt)
app.get("/api/admin/credentials", requireAdmin, (_req, res) => {
  const db = loadCreds();
  db.accounts = db.accounts.map(resetCredIfNeeded);
  saveCreds(db);
  res.json({
    currentIndex: db.currentIndex,
    total: db.accounts.length,
    accounts: db.accounts.map((a, i) => ({
      index: i,
      label: a.label,
      accountId: a.accountId,
      token: a.token.slice(0, 8) + "****" + a.token.slice(-4),
      dailyUsage: a.dailyUsage,
      exhausted: a.exhausted,
      active: i === db.currentIndex,
    })),
  });
});

// POST /api/admin/credentials — thêm account mới
app.post("/api/admin/credentials", requireAdmin, (req, res) => {
  const { accountId, token, label } = req.body as { accountId: string; token: string; label?: string };
  if (!accountId || !token) {
    res.status(400).json({ error: "Thiếu accountId hoặc token" });
    return;
  }
  const db = loadCreds();
  const newAcc: CFAccount = {
    label: label || `Account ${db.accounts.length + 1}`,
    accountId,
    token,
    dailyUsage: 0,
    lastReset: today(),
    exhausted: false,
  };
  db.accounts.push(newAcc);
  saveCreds(db);
  res.json({
    success: true,
    message: `Đã thêm "${newAcc.label}" vào pool. Tổng: ${db.accounts.length} account(s).`,
    index: db.accounts.length - 1,
  });
});

// DELETE /api/admin/credentials/:index — xóa account
app.delete("/api/admin/credentials/:index", requireAdmin, (req, res) => {
  const idx = parseInt(req.params.index);
  const db = loadCreds();
  if (isNaN(idx) || idx < 0 || idx >= db.accounts.length) {
    res.status(404).json({ error: "Index không hợp lệ" });
    return;
  }
  const removed = db.accounts.splice(idx, 1)[0];
  if (db.currentIndex >= db.accounts.length) db.currentIndex = 0;
  saveCreds(db);
  res.json({ success: true, message: `Đã xóa "${removed.label}"` });
});

// POST /api/admin/credentials/:index/reset — reset quota của 1 account
app.post("/api/admin/credentials/:index/reset", requireAdmin, (req, res) => {
  const idx = parseInt(req.params.index);
  const db = loadCreds();
  if (isNaN(idx) || idx < 0 || idx >= db.accounts.length) {
    res.status(404).json({ error: "Index không hợp lệ" });
    return;
  }
  db.accounts[idx].dailyUsage = 0;
  db.accounts[idx].exhausted = false;
  db.accounts[idx].lastReset = today();
  saveCreds(db);
  res.json({ success: true, message: `Đã reset quota cho "${db.accounts[idx].label}"` });
});

// POST /api/admin/credentials/reset-all — reset tất cả
app.post("/api/admin/credentials/reset-all", requireAdmin, (_req, res) => {
  const db = loadCreds();
  db.accounts = db.accounts.map(a => ({ ...a, dailyUsage: 0, exhausted: false, lastReset: today() }));
  db.currentIndex = 0;
  saveCreds(db);
  res.json({ success: true, message: `Đã reset quota cho tất cả ${db.accounts.length} account(s)` });
});

// GET /api/admin/key — xem admin key (chỉ admin mới biết key để gọi endpoint này)
app.get("/api/admin/key", requireAdmin, (_req, res) => {
  res.json({
    adminKey: getAdminKey(),
    source: process.env.ADMIN_KEY ? "env:ADMIN_KEY" : "file",
  });
});

// POST /api/admin/backup — chạy backup thủ công lên GitHub
app.post("/api/admin/backup", requireAdmin, async (_req, res) => {
  try {
    const result = await runBackup();
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Production: serve frontend static files ────────────────────────────────
if (IS_PRODUCTION) {
  const staticDir = path.join(__dirname, "../dist/public");
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// Trên Render: restore data từ GitHub trước khi lắng nghe (disk ephemeral)
if (IS_PRODUCTION) {
  await restoreFromGitHub();
}

app.listen(API_PORT, () => {
  const adminKey = getAdminKey();
  const source = process.env.ADMIN_KEY ? "biến môi trường ADMIN_KEY" : "tự sinh (lưu trong file)";
  const repo = process.env.GITHUB_REPO || "(chưa cấu hình)";
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Server running on port ${API_PORT}`);
  console.log(`  Mode: ${IS_PRODUCTION ? "production (Render)" : "development (Replit)"}`);
  console.log(`  🔑 ADMIN KEY: ${adminKey}`);
  console.log(`  Nguồn: ${source}`);
  console.log(`  📦 Backup repo: ${repo}`);
  console.log(`${"═".repeat(60)}\n`);

  // Khởi động auto backup lên GitHub mỗi 6 giờ
  scheduleBackup(6 * 60 * 60 * 1000);
});
