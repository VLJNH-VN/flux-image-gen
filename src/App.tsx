import { useState, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import {
  Wand2, Image, Download, RefreshCw, Sparkles, Loader2, Copy, Check,
  Key, Shield, BookOpen, Plus, Trash2, RotateCcw, Eye, EyeOff, ChevronRight,
} from "lucide-react";

const queryClient = new QueryClient();

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

// ─── API helpers ─────────────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const api = (path: string) => `${BASE}/api${path}`;

// ─── Generator Tab ───────────────────────────────────────────────────────────
function GeneratorTab() {
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState("");
  const [selectedSize, setSelectedSize] = useState(SIZES[0]);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [editedPrompt, setEditedPrompt] = useState("");
  const [imageData, setImageData] = useState<{ image: string; mimeType: string } | null>(null);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [steps, setSteps] = useState(4);

  const handleGeneratePrompt = useCallback(async () => {
    if (!idea.trim()) { toast.error("Vui lòng nhập ý tưởng!"); return; }
    setIsGeneratingPrompt(true);
    try {
      const res = await fetch(api("/generate-prompt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, style }),
      });
      const data = await res.json() as { prompt?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Lỗi không xác định");
      setGeneratedPrompt(data.prompt || "");
      setEditedPrompt(data.prompt || "");
      toast.success("Đã tạo prompt!");
    } catch (err: unknown) { toast.error((err as Error).message); }
    finally { setIsGeneratingPrompt(false); }
  }, [idea, style]);

  const handleGenerateImage = useCallback(async () => {
    const prompt = editedPrompt || generatedPrompt;
    if (!prompt.trim()) { toast.error("Vui lòng tạo prompt trước!"); return; }
    setIsGeneratingImage(true); setImageData(null);
    try {
      const res = await fetch(api("/generate-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, width: selectedSize.width, height: selectedSize.height, steps }),
      });
      const data = await res.json() as { image?: string; mimeType?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Lỗi không xác định");
      setImageData({ image: data.image!, mimeType: data.mimeType || "image/png" });
      toast.success("Ảnh đã được tạo!");
    } catch (err: unknown) { toast.error((err as Error).message); }
    finally { setIsGeneratingImage(false); }
  }, [editedPrompt, generatedPrompt, selectedSize, steps]);

  const handleDownload = useCallback(() => {
    if (!imageData) return;
    const link = document.createElement("a");
    link.href = `data:${imageData.mimeType};base64,${imageData.image}`;
    link.download = `flux-${Date.now()}.png`;
    link.click();
  }, [imageData]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-5">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="w-4 h-4 text-primary" />Ý tưởng của bạn</label>
          <textarea value={idea} onChange={e => setIdea(e.target.value)} placeholder="Mô tả bức ảnh bạn muốn tạo..." className="w-full bg-background border border-input rounded-lg px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" rows={4} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleGeneratePrompt(); }} />
          <p className="text-xs text-muted-foreground">Nhấn Ctrl+Enter để tạo prompt nhanh</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <label className="text-sm font-semibold">Phong cách nghệ thuật</label>
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map(s => (
              <button key={s.value} onClick={() => setStyle(s.value)} className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${style === s.value ? "bg-primary border-primary text-primary-foreground" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}>{s.label}</button>
            ))}
          </div>
        </div>

        <button onClick={handleGeneratePrompt} disabled={isGeneratingPrompt || !idea.trim()} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
          {isGeneratingPrompt ? <><Loader2 className="w-4 h-4 animate-spin" />Gemini đang tạo prompt...</> : <><Sparkles className="w-4 h-4" />Tạo Prompt với Gemini AI</>}
        </button>

        {(generatedPrompt || editedPrompt) && (
          <div className="bg-card border border-primary/30 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">Prompt (có thể chỉnh sửa)</label>
              <button onClick={() => { navigator.clipboard.writeText(editedPrompt || generatedPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}{copied ? "Đã sao chép" : "Sao chép"}
              </button>
            </div>
            <textarea value={editedPrompt} onChange={e => setEditedPrompt(e.target.value)} className="w-full bg-background border border-input rounded-lg px-4 py-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring resize-none font-mono leading-relaxed" rows={5} />
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <label className="text-sm font-semibold">Cài đặt ảnh</label>
          <div className="grid grid-cols-2 gap-2">
            {SIZES.map(sz => (
              <button key={sz.label} onClick={() => setSelectedSize(sz)} className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all text-left ${selectedSize.label === sz.label ? "bg-primary/20 border-primary text-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"}`}>
                <div>{sz.label}</div><div className="text-[10px] opacity-60">{sz.width}×{sz.height}</div>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between"><span className="text-xs text-muted-foreground">Số bước</span><span className="text-xs font-mono text-primary">{steps}</span></div>
            <input type="range" min={1} max={8} value={steps} onChange={e => setSteps(Number(e.target.value))} className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>Nhanh (1)</span><span>Chất lượng (8)</span></div>
          </div>
        </div>

        <button onClick={handleGenerateImage} disabled={isGeneratingImage || (!generatedPrompt && !editedPrompt)} className="w-full py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg">
          {isGeneratingImage ? <><Loader2 className="w-4 h-4 animate-spin" />Flux đang tạo ảnh...</> : <><Image className="w-4 h-4" />Tạo Ảnh với Flux AI</>}
        </button>
      </div>

      <div className="space-y-4">
        <div className="bg-card border border-border rounded-xl overflow-hidden" style={{ aspectRatio: `${selectedSize.width}/${selectedSize.height}`, minHeight: 300 }}>
          {isGeneratingImage ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 min-h-[300px]">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Flux đang xử lý...</p>
            </div>
          ) : imageData ? (
            <img src={`data:${imageData.mimeType};base64,${imageData.image}`} alt="Generated" className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 min-h-[300px]">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center"><Image className="w-8 h-8 text-primary/50" /></div>
              <p className="text-sm text-foreground/50">Ảnh sẽ hiển thị ở đây</p>
            </div>
          )}
        </div>
        {imageData && (
          <div className="flex gap-3">
            <button onClick={handleDownload} className="flex-1 py-2.5 rounded-xl bg-card border border-border text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent transition-all"><Download className="w-4 h-4" />Tải ảnh</button>
            <button onClick={handleGenerateImage} className="flex-1 py-2.5 rounded-xl bg-card border border-border text-sm font-medium flex items-center justify-center gap-2 hover:bg-accent transition-all"><RefreshCw className="w-4 h-4" />Tạo lại</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Management Tab ───────────────────────────────────────────────────────────
interface MeInfo { ip: string; key: string | null; type: string; quota: { used: number; limit: number | string; remaining?: number } }
interface CFCred { index: number; label: string; accountId: string; token: string; dailyUsage: number; exhausted: boolean; active: boolean }

function ManagementTab() {
  const [me, setMe] = useState<MeInfo | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [vipKey, setVipKey] = useState("");
  const [loadingMe, setLoadingMe] = useState(false);
  const [loadingVip, setLoadingVip] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Admin
  const [adminKey, setAdminKey] = useState("");
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [creds, setCreds] = useState<CFCred[]>([]);
  const [newAccId, setNewAccId] = useState("");
  const [newToken, setNewToken] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const fetchMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const res = await fetch(api("/me"));
      const data = await res.json() as MeInfo;
      setMe(data);
      if (data.key && !vipKey) setVipKey(data.key);
    } catch { toast.error("Không thể lấy thông tin"); }
    finally { setLoadingMe(false); }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const handleUpgradeVip = async () => {
    if (!vipKey || !cfAccountId || !cfToken) { toast.error("Vui lòng điền đầy đủ thông tin"); return; }
    setLoadingVip(true);
    try {
      const res = await fetch(api("/key/vip"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: vipKey, cfAccountId, cfToken }),
      });
      const data = await res.json() as { key?: string; status?: string; error?: string; note?: string; addedToPool?: boolean };
      if (!res.ok) { toast.error(data.error || "Lỗi nâng cấp"); return; }
      toast.success(`${data.status} ${data.addedToPool ? "— Đã thêm vào pool!" : ""}`);
      fetchMe();
    } catch { toast.error("Lỗi kết nối"); }
    finally { setLoadingVip(false); }
  };

  const [retrievedAdminKey, setRetrievedAdminKey] = useState<string | null>(null);

  const fetchCreds = async (key: string) => {
    setLoadingAdmin(true);
    try {
      const res = await fetch(api("/admin/credentials"), { headers: { "x-admin-key": key } });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      setCreds(data.accounts);
      // Lấy admin key để hiển thị xác nhận
      const keyRes = await fetch(api("/admin/key"), { headers: { "x-admin-key": key } });
      if (keyRes.ok) {
        const keyData = await keyRes.json() as { adminKey: string };
        setRetrievedAdminKey(keyData.adminKey);
      }
    } catch { toast.error("Lỗi kết nối"); }
    finally { setLoadingAdmin(false); }
  };

  const handleAddCred = async () => {
    if (!newAccId || !newToken) { toast.error("Điền đủ Account ID và Token"); return; }
    try {
      const res = await fetch(api("/admin/credentials"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ accountId: newAccId, token: newToken, label: newLabel || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success(data.message);
      setNewAccId(""); setNewToken(""); setNewLabel("");
      fetchCreds(adminKey);
    } catch { toast.error("Lỗi kết nối"); }
  };

  const handleDeleteCred = async (idx: number) => {
    try {
      const res = await fetch(api(`/admin/credentials/${idx}`), { method: "DELETE", headers: { "x-admin-key": adminKey } });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success(data.message);
      fetchCreds(adminKey);
    } catch { toast.error("Lỗi kết nối"); }
  };

  const handleResetCred = async (idx: number) => {
    try {
      const res = await fetch(api(`/admin/credentials/${idx}/reset`), { method: "POST", headers: { "x-admin-key": adminKey } });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      toast.success(data.message);
      fetchCreds(adminKey);
    } catch { toast.error("Lỗi kết nối"); }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Thông tin IP & key */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><Key className="w-4 h-4 text-primary" />Tài khoản của bạn (theo IP)</h2>
          <button onClick={fetchMe} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><RefreshCw className="w-3 h-3" />Làm mới</button>
        </div>

        {loadingMe ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : me ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-background rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Loại tài khoản</p>
                <p className={`text-sm font-bold mt-1 ${me.type === "vip" ? "text-yellow-400" : "text-primary"}`}>{me.type === "vip" ? "⭐ VIP" : "🆓 Free"}</p>
              </div>
              <div className="bg-background rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Quota hôm nay</p>
                <p className="text-sm font-bold mt-1 text-foreground">
                  {me.type === "free" ? `${me.quota.used} / ${me.quota.limit}` : `${me.quota.used} (không giới hạn)`}
                </p>
              </div>
            </div>
            {me.type === "free" && typeof me.quota.remaining === "number" && (
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${Math.min(100, (Number(me.quota.used) / Number(me.quota.limit)) * 100)}%` }} />
              </div>
            )}

            {/* Key luôn hiển thị */}
            {me.key && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-primary">🔑 Key của bạn</p>
                  <button onClick={() => setShowKey(v => !v)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    {showKey ? <><EyeOff className="w-3 h-3" />Ẩn</> : <><Eye className="w-3 h-3" />Hiện</>}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-background rounded px-3 py-2 font-mono text-primary">
                    {showKey ? me.key : "FLUX-••••••-••••••-••••••"}
                  </code>
                  <button onClick={() => { navigator.clipboard.writeText(me.key!); toast.success("Đã sao chép key!"); }} className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-all">
                    <Copy className="w-4 h-4 text-primary" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Nâng cấp VIP */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-yellow-400" />Nâng cấp VIP</h2>
        <p className="text-xs text-muted-foreground">Thêm Cloudflare Account ID và Token riêng để tạo ảnh không giới hạn và token của bạn sẽ được thêm vào pool.</p>
        <div className="space-y-3">
          <input value={vipKey} onChange={e => setVipKey(e.target.value)} placeholder="Key hiện tại của bạn (FLUX-xxx-xxx-xxx)" className="w-full bg-background border border-input rounded-lg px-4 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <input value={cfAccountId} onChange={e => setCfAccountId(e.target.value)} placeholder="Cloudflare Account ID" className="w-full bg-background border border-input rounded-lg px-4 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <div className="relative">
            <input type={showToken ? "text" : "password"} value={cfToken} onChange={e => setCfToken(e.target.value)} placeholder="Cloudflare API Token" className="w-full bg-background border border-input rounded-lg px-4 py-2.5 pr-10 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
          <button onClick={handleUpgradeVip} disabled={loadingVip} className="w-full py-2.5 rounded-xl bg-gradient-to-r from-yellow-600 to-orange-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all">
            {loadingVip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {loadingVip ? "Đang kiểm tra..." : "Nâng cấp VIP"}
          </button>
          <p className="text-xs text-muted-foreground text-center">Tạo token tại <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" className="text-primary hover:underline">dash.cloudflare.com → Workers AI</a></p>
        </div>
      </div>

      {/* Admin Panel */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-red-400" />Admin Panel</h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input type={showAdminKey ? "text" : "password"} value={adminKey} onChange={e => setAdminKey(e.target.value)} placeholder="Nhập Admin Key" className="w-full bg-background border border-input rounded-lg px-4 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring pr-10" />
            <button onClick={() => setShowAdminKey(!showAdminKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showAdminKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
          <button onClick={() => fetchCreds(adminKey)} disabled={!adminKey || loadingAdmin} className="px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
            {loadingAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}Xem
          </button>
        </div>

        {retrievedAdminKey && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-1">
            <p className="text-xs font-semibold text-red-400">🔑 Admin Key của bạn (vĩnh viễn — không thể tạo lại):</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-background rounded px-3 py-2 font-mono text-red-300 break-all">{retrievedAdminKey}</code>
              <button onClick={() => { navigator.clipboard.writeText(retrievedAdminKey); toast.success("Đã sao chép!"); }} className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-all flex-shrink-0"><Copy className="w-4 h-4 text-red-400" /></button>
            </div>
          </div>
        )}

        {creds.length > 0 && (
          <div className="space-y-3">
            <div className="space-y-2">
              {creds.map(c => (
                <div key={c.index} className={`bg-background rounded-lg p-3 border ${c.active ? "border-primary/50" : c.exhausted ? "border-red-500/30" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{c.label}</span>
                      {c.active && <span className="ml-2 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">Đang dùng</span>}
                      {c.exhausted && <span className="ml-2 text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full">Hết quota</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => handleResetCred(c.index)} title="Reset quota" className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"><RotateCcw className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDeleteCred(c.index)} title="Xóa" className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    <span>ID: {c.accountId.slice(0, 8)}...</span>
                    <span>Token: {c.token}</span>
                    <span>Đã dùng: {c.dailyUsage}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Thêm Account mới</p>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Tên (tuỳ chọn)" className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <input value={newAccId} onChange={e => setNewAccId(e.target.value)} placeholder="Account ID" className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <input value={newToken} onChange={e => setNewToken(e.target.value)} placeholder="API Token" className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
              <button onClick={handleAddCred} className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-all"><Plus className="w-4 h-4" />Thêm vào Pool</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── API Docs Tab ─────────────────────────────────────────────────────────────
function ApiDocsTab() {
  const [copied, setCopied] = useState<string | null>(null);
  const copyCode = (id: string, text: string) => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000); };

  const endpoints = [
    { method: "GET", path: "/api/health", desc: "Kiểm tra trạng thái server", body: null },
    { method: "GET", path: "/api/me", desc: "Thông tin tài khoản theo IP (key, quota, loại)", body: null },
    { method: "GET", path: "/api/styles", desc: "Danh sách phong cách nghệ thuật", body: null },
    { method: "GET", path: "/api/sizes", desc: "Danh sách kích thước ảnh", body: null },
    { method: "POST", path: "/api/key/register", desc: "Đăng ký key free theo IP (hiển thị 1 lần)", body: "{}" },
    { method: "POST", path: "/api/key/vip", desc: "Nâng cấp VIP bằng CF credentials", body: '{"key":"FLUX-xxx","cfAccountId":"...","cfToken":"..."}' },
    { method: "GET", path: "/api/key/info?key=xxx", desc: "Xem quota & loại tài khoản", body: null },
    { method: "POST", path: "/api/key/check-cf", desc: "Kiểm tra CF token còn sống không", body: '{"key":"FLUX-xxx"}' },
    { method: "POST", path: "/api/generate-prompt", desc: "Tạo prompt từ ý tưởng (Gemini AI)", body: '{"idea":"một con rồng lửa","style":"fantasy art"}' },
    { method: "POST", path: "/api/generate-image", desc: "Tạo ảnh từ prompt (Flux AI)", body: '{"prompt":"A fire dragon...","width":1024,"height":1024,"steps":4}' },
    { method: "POST", path: "/api/generate-all", desc: "Tạo ảnh từ ý tưởng (gộp 2 bước)", body: '{"idea":"một con rồng lửa","style":"anime","width":1024,"height":1024}' },
    { method: "GET", path: "/api/admin/key", desc: "Xem Admin Key hiện tại (cần Admin Key header — để xác nhận key đang dùng)", body: null },
    { method: "GET", path: "/api/admin/credentials", desc: "Xem CF pool (cần Admin Key)", body: null },
    { method: "POST", path: "/api/admin/credentials", desc: "Thêm CF account vào pool (cần Admin Key)", body: '{"accountId":"...","token":"...","label":"Account 2"}' },
    { method: "DELETE", path: "/api/admin/credentials/:index", desc: "Xóa CF account khỏi pool", body: null },
    { method: "POST", path: "/api/admin/credentials/:index/reset", desc: "Reset quota 1 account", body: null },
    { method: "POST", path: "/api/admin/credentials/reset-all", desc: "Reset quota tất cả accounts", body: null },
  ];

  const methodColor: Record<string, string> = {
    GET: "text-green-400 bg-green-500/10",
    POST: "text-blue-400 bg-blue-500/10",
    DELETE: "text-red-400 bg-red-500/10",
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground">Base URL: <code className="text-primary font-mono">{window.location.origin}</code></p>
        <p className="text-xs text-muted-foreground mt-1">Admin endpoints yêu cầu header: <code className="text-primary font-mono">X-Admin-Key: ADMIN-xxx</code></p>
      </div>
      <div className="space-y-2">
        {endpoints.map((ep, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${methodColor[ep.method] || "text-muted-foreground bg-muted"}`}>{ep.method}</span>
                <code className="text-sm text-foreground font-mono">{ep.path}</code>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{ep.desc}</p>
            {ep.body && (
              <div className="relative">
                <pre className="bg-background rounded-lg p-3 text-xs font-mono text-foreground/80 overflow-x-auto">{ep.body}</pre>
                <button onClick={() => copyCode(`${i}`, ep.body!)} className="absolute right-2 top-2 p-1.5 rounded bg-muted hover:bg-accent transition-all">
                  {copied === `${i}` ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
type Tab = "generator" | "management" | "api";

function Main() {
  const [tab, setTab] = useState<Tab>("generator");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "generator", label: "Tạo Ảnh", icon: <Sparkles className="w-4 h-4" /> },
    { id: "management", label: "Quản lý", icon: <Key className="w-4 h-4" /> },
    { id: "api", label: "API Docs", icon: <BookOpen className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none">Flux AI Image Generator</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Powered by Gemini + Cloudflare Workers AI</p>
            </div>
          </div>
          <div className="flex gap-1 bg-muted/50 rounded-xl p-1">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {tab === "generator" && <GeneratorTab />}
        {tab === "management" && <ManagementTab />}
        {tab === "api" && <ApiDocsTab />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Main />
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}
