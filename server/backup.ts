import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Cấu hình ──────────────────────────────────────────────────────────────────
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN  || "";
const GITHUB_REPO   = process.env.GITHUB_REPO   || "";   // VLJNH-VN/flux-image-gen
const BACKUP_BRANCH = "main";

// ── File cần backup / restore (chỉ của flux-image-gen) ───────────────────────
const DATA_DIR = path.join(__dirname, "data");

const BACKUP_FILES = [
  { local: path.join(DATA_DIR, "credentials.json"), remote: "data/credentials.json" },
  { local: path.join(DATA_DIR, "keys.json"),        remote: "data/keys.json"        },
];

// ── GitHub API helper ─────────────────────────────────────────────────────────
function githubRequest(
  method: string,
  apiPath: string,
  body: Record<string, unknown> | null = null
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options: https.RequestOptions = {
      hostname: "api.github.com",
      path:     apiPath,
      method,
      headers: {
        Authorization:  `token ${GITHUB_TOKEN}`,
        "User-Agent":   "FluxImageGen-Backup/1.0",
        Accept:         "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      } as Record<string, string>,
    };
    if (bodyStr) (options.headers as Record<string, string>)["Content-Length"] = String(Buffer.byteLength(bodyStr));

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode || 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 0, body: {} }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Lấy SHA của file đang có trên GitHub
async function getFileSHA(remotePath: string): Promise<string | null> {
  try {
    const res = await githubRequest("GET", `/repos/${GITHUB_REPO}/contents/${remotePath}?ref=${BACKUP_BRANCH}`);
    if (res.status === 200 && (res.body as { sha?: string }).sha) {
      return (res.body as { sha: string }).sha;
    }
  } catch { /* file chưa có */ }
  return null;
}

// Upload 1 file lên GitHub
async function uploadFile(localPath: string, remotePath: string): Promise<{ ok: boolean; skip?: boolean; status?: number }> {
  if (!fs.existsSync(localPath)) return { ok: false, skip: true };

  const contentB64 = fs.readFileSync(localPath).toString("base64");
  const sha = await getFileSHA(remotePath);

  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const payload: Record<string, unknown> = {
    message: `[Backup] ${path.basename(remotePath)} — ${now}`,
    content: contentB64,
    branch:  BACKUP_BRANCH,
  };
  if (sha) payload.sha = sha;

  const res = await githubRequest("PUT", `/repos/${GITHUB_REPO}/contents/${remotePath}`, payload);
  return { ok: res.status === 200 || res.status === 201, status: res.status };
}

// ── Restore 1 file từ GitHub về local ────────────────────────────────────────
async function downloadFile(remotePath: string, localPath: string): Promise<{ ok: boolean; skip?: boolean }> {
  try {
    const res = await githubRequest("GET", `/repos/${GITHUB_REPO}/contents/${remotePath}?ref=${BACKUP_BRANCH}`);
    if (res.status === 404) return { ok: false, skip: true };
    if (res.status !== 200) return { ok: false };

    const content = (res.body as { content?: string }).content;
    if (!content) return { ok: false };

    // GitHub trả về base64 có newline, cần xóa đi
    const decoded = Buffer.from(content.replace(/\n/g, ""), "base64");
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, decoded);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ── Restore toàn bộ data từ GitHub (dùng khi khởi động trên Render) ──────────
export async function restoreFromGitHub(): Promise<void> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("[Restore] Chưa cấu hình GITHUB_TOKEN / GITHUB_REPO — bỏ qua restore.");
    return;
  }

  console.log(`[Restore] Đang restore data từ github.com/${GITHUB_REPO}...`);

  for (const { local, remote } of BACKUP_FILES) {
    const name = path.basename(local);
    // Chỉ restore nếu file chưa tồn tại (tránh ghi đè data mới hơn)
    if (fs.existsSync(local)) {
      console.log(`[Restore] ⏭  ${name} (đã tồn tại, bỏ qua)`);
      continue;
    }
    try {
      const res = await downloadFile(remote, local);
      if (res.skip)   console.log(`[Restore] ⏭  ${name} (chưa có backup trên GitHub)`);
      else if (res.ok) console.log(`[Restore] ✅ ${name} ← github.com/${GITHUB_REPO}`);
      else             console.error(`[Restore] ❌ ${name} (lỗi tải về)`);
    } catch (err: unknown) {
      console.error(`[Restore] ❌ ${name}: ${(err as Error).message}`);
    }
  }
}

// ── Backup chính ──────────────────────────────────────────────────────────────
export async function runBackup(): Promise<{ success: boolean; ok: number; fail: number; skip: number; time: string }> {
  const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn(`[Backup] Chưa cấu hình GITHUB_TOKEN / GITHUB_REPO — bỏ qua backup.`);
    return { success: false, ok: 0, fail: 0, skip: 0, time: now };
  }

  let ok = 0, fail = 0, skip = 0;

  for (const { local, remote } of BACKUP_FILES) {
    const name = path.basename(local);
    try {
      const res = await uploadFile(local, remote);
      if (res.skip)    { skip++; console.log(`[Backup] ⏭  ${name} (không tồn tại)`); }
      else if (res.ok) { ok++;   console.log(`[Backup] ✅ ${name} → github.com/${GITHUB_REPO}`); }
      else             { fail++; console.error(`[Backup] ❌ ${name} (HTTP ${res.status})`); }
    } catch (err: unknown) {
      fail++;
      console.error(`[Backup] ❌ ${name}: ${(err as Error).message}`);
    }
  }

  console.log(`[Backup] ${now}: ✅${ok} ⏭${skip} ❌${fail}`);
  return { success: true, ok, fail, skip, time: now };
}

// ── Auto backup theo lịch ─────────────────────────────────────────────────────
export function scheduleBackup(intervalMs = 6 * 60 * 60 * 1000): void {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn("[Backup] GITHUB_TOKEN / GITHUB_REPO chưa đặt → auto backup TẮT.");
    return;
  }

  // Backup lần đầu sau 30 giây
  setTimeout(() => runBackup(), 30 * 1000);
  // Sau đó backup định kỳ
  setInterval(() => runBackup(), intervalMs).unref?.();

  const h = Math.round(intervalMs / 3600000);
  console.log(`[Backup] Auto backup mỗi ${h}h → github.com/${GITHUB_REPO}`);
}
