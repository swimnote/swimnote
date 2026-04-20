import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import router from "./routes";
import { initPushTables } from "./lib/push-service.js";
import { startPushScheduler } from "./jobs/push-scheduler.js";
import { recordResponseTime } from "./lib/responseTracker.js";
import { requireNotDeactivated } from "./lib/deactivationGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// ── CORS ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  // Render production 서버 (신규)
  /^https:\/\/.*\.onrender\.com$/,
  // Replit 운영 도메인 (레거시 유지)
  "https://swimnote-7.replit.app",
  "https://swimnote-8.pcrskm.replit.app",
  // EAS 빌드 / 개발 Expo
  /^https:\/\/.*\.expo\.dev$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/.*\.sisko\.replit\.dev$/,
  /^https:\/\/.*\.pike\.replit\.dev$/,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === "string" ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    return callback(new Error(`CORS 차단: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── 전역 no-cache 미들웨어 (/api JSON 응답) ─────────────────────────────
// 미디어(사진·영상·업로드) 라우트는 개별 Cache-Control로 덮어씀
app.use("/api", (_req: Request, res: Response, next: NextFunction) => {
  // 스태틱 파일(.jpg .mp4 등) 제외
  if (!/\.(jpg|jpeg|png|gif|webp|mp4|m4v|ts|m3u8|svg|pdf|zip)$/i.test(_req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

// ── 응답시간 추적 미들웨어 (슈퍼관리자 서버 느려짐 감지용) ─────────────────
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  // 헬스체크·스태틱 제외
  if (req.path === "/healthz" || /\.(jpg|jpeg|png|gif|webp|mp4|m4v|ts|m3u8|svg|pdf|zip)$/i.test(req.path)) {
    return next();
  }
  const start = Date.now();
  res.on("finish", () => {
    recordResponseTime(Date.now() - start);
  });
  next();
});

app.use("/api/store-assets", express.static(path.join(__dirname, "../public/store-assets")));

// ── 구독 취소 후 90일 비활성화 수영장 전면 차단 ────────────────────────────
app.use("/api", requireNotDeactivated);

// ── SVG 업로드 페이지 ─────────────────────────────────────────────────
const SVG_DEST = path.resolve("/home/runner/workspace/artifacts/swim-app/assets/images");
const svgUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SVG_DEST),
    filename: (_req, file, cb) => cb(null, file.originalname),
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/svg+xml" || file.originalname.endsWith(".svg")) cb(null, true);
    else cb(new Error("SVG 파일만 업로드 가능합니다."));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.get(["/svg-upload", "/api/svg-upload"], (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG 업로드</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 40px; width: 100%; max-width: 480px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    h1 { font-size: 22px; font-weight: 700; color: #0a2540; margin-bottom: 8px; }
    p { font-size: 14px; color: #666; margin-bottom: 28px; }
    .drop-zone { border: 2px dashed #c8d6e5; border-radius: 12px; padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s; background: #f8fafc; }
    .drop-zone:hover, .drop-zone.over { border-color: #0a2540; background: #eef4fb; }
    .drop-zone input { display: none; }
    .drop-zone-label { font-size: 15px; color: #555; }
    .drop-zone-label strong { color: #0a2540; }
    .file-name { margin-top: 14px; font-size: 13px; color: #0a2540; font-weight: 600; min-height: 20px; }
    button { margin-top: 24px; width: 100%; padding: 14px; background: #0a2540; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 700; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #154a6d; }
    button:disabled { background: #aaa; cursor: not-allowed; }
    .result { margin-top: 16px; padding: 12px 16px; border-radius: 8px; font-size: 14px; display: none; }
    .result.ok { background: #e6f9f0; color: #1a7a4a; }
    .result.err { background: #fff0f0; color: #c0392b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>SVG 파일 업로드</h1>
    <p>swim-app/assets/images/ 폴더에 저장됩니다.</p>
    <div class="drop-zone" id="dropZone">
      <label for="fileInput">
        <div class="drop-zone-label">
          파일을 여기에 <strong>드래그</strong>하거나<br>클릭해서 선택
        </div>
        <input type="file" id="fileInput" accept=".svg,image/svg+xml">
      </label>
      <div class="file-name" id="fileName"></div>
    </div>
    <button id="uploadBtn" disabled>업로드</button>
    <div class="result" id="result"></div>
  </div>
  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileName = document.getElementById('fileName');
    const uploadBtn = document.getElementById('uploadBtn');
    const result = document.getElementById('result');
    let selectedFile = null;

    fileInput.addEventListener('change', e => setFile(e.target.files[0]));
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
    dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('over'); setFile(e.dataTransfer.files[0]); });

    function setFile(f) {
      if (!f) return;
      selectedFile = f;
      fileName.textContent = f.name;
      uploadBtn.disabled = false;
    }

    uploadBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = '업로드 중...';
      result.style.display = 'none';
      const fd = new FormData();
      fd.append('svg', selectedFile);
      try {
        const res = await fetch('/api/svg-upload', { method: 'POST', body: fd });
        const data = await res.json();
        result.style.display = 'block';
        if (res.ok) {
          result.className = 'result ok';
          result.textContent = '✓ ' + data.message;
        } else {
          result.className = 'result err';
          result.textContent = '✗ ' + (data.message || '업로드 실패');
        }
      } catch(e) {
        result.style.display = 'block';
        result.className = 'result err';
        result.textContent = '✗ 네트워크 오류';
      }
      uploadBtn.disabled = false;
      uploadBtn.textContent = '업로드';
    });
  </script>
</body>
</html>`);
});

app.post(["/svg-upload", "/api/svg-upload"], svgUpload.single("svg"), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ success: false, message: "파일이 없습니다." });
  const savedPath = path.join(SVG_DEST, req.file.filename);
  if (!fs.existsSync(savedPath)) return res.status(500).json({ success: false, message: "저장 실패" });
  res.json({ success: true, message: `${req.file.filename} 저장 완료 (${SVG_DEST})` });
});

app.use("/api", router);

// 헬스체크 — /api/health, /health, /api/healthz, /healthz 모두 지원
app.get(["/health", "/api/health", "/healthz", "/api/healthz"], (_req: Request, res: Response) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), version: "v2.1-2026-04-04" });
});

// ── 서비스 소개 랜딩 페이지 (루트) ────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SwimNote — 수영장 통합 관리 플랫폼</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif; background: #f0f4f8; color: #1a1a2e; }
    .hero { background: linear-gradient(135deg, #0a2540 0%, #1565c0 100%); color: #fff; padding: 64px 24px 56px; text-align: center; }
    .hero .logo { font-size: 44px; margin-bottom: 12px; }
    .hero h1 { font-size: 30px; font-weight: 800; margin-bottom: 10px; }
    .hero p { font-size: 16px; color: #a8c8f8; max-width: 480px; margin: 0 auto; line-height: 1.7; }
    .badges { display: flex; justify-content: center; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
    .badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 20px; padding: 6px 16px; font-size: 13px; color: #fff; }
    .container { max-width: 860px; margin: 0 auto; padding: 48px 24px 80px; }
    .section-title { font-size: 20px; font-weight: 700; color: #0a2540; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e0e8f0; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 40px; }
    .card { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    .card .icon { font-size: 32px; margin-bottom: 12px; }
    .card h3 { font-size: 16px; font-weight: 700; color: #0a2540; margin-bottom: 8px; }
    .card p { font-size: 14px; color: #555; line-height: 1.7; }
    .plans { background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 40px; }
    .plan-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f4f8; font-size: 14px; }
    .plan-row:last-child { border-bottom: none; }
    .plan-name { font-weight: 600; color: #0a2540; }
    .plan-detail { color: #666; font-size: 13px; }
    .plan-price { font-weight: 700; color: #1565c0; }
    .store-links { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 40px; }
    .store-btn { display: inline-flex; align-items: center; gap: 8px; background: #0a2540; color: #fff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-size: 14px; font-weight: 600; }
    .store-btn:hover { background: #1565c0; }
    .info-box { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    .info-row { display: flex; gap: 12px; padding: 8px 0; font-size: 14px; color: #444; }
    .info-label { font-weight: 600; color: #0a2540; min-width: 100px; }
    .footer { text-align: center; padding: 32px 24px; font-size: 13px; color: #999; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="logo">🏊</div>
    <h1>SwimNote</h1>
    <p>수영장·코치를 위한 통합 회원 관리 플랫폼<br>출석, 수업일지, 영상 피드백, 구독 관리까지</p>
    <div class="badges">
      <span class="badge">iOS App</span>
      <span class="badge">Android App</span>
      <span class="badge">B2B SaaS</span>
      <span class="badge">수영장 관리</span>
    </div>
  </div>

  <div class="container">
    <p class="section-title" style="margin-top:0">주요 기능</p>
    <div class="cards">
      <div class="card">
        <div class="icon">👥</div>
        <h3>회원 관리</h3>
        <p>수영장 회원 등록, 반 배정, 출석 체크를 앱 하나로 처리합니다.</p>
      </div>
      <div class="card">
        <div class="icon">📓</div>
        <h3>수업 일지</h3>
        <p>코치가 직접 수업 일지를 작성하고 사진·영상을 첨부해 학부모에게 전달합니다.</p>
      </div>
      <div class="card">
        <div class="icon">📲</div>
        <h3>학부모 앱</h3>
        <p>학부모는 카카오 간편가입으로 자녀 출석·수업 기록을 실시간으로 확인합니다.</p>
      </div>
      <div class="card">
        <div class="icon">💳</div>
        <h3>구독 관리</h3>
        <p>App Store·Google Play 인앱 결제로 플랜을 관리하며 자동 갱신됩니다.</p>
      </div>
    </div>

    <p class="section-title">구독 플랜</p>
    <div class="plans">
      <div class="plan-row">
        <span class="plan-name">Free</span>
        <span class="plan-detail">회원 10명 · 100MB</span>
        <span class="plan-price">무료</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Coach30</span>
        <span class="plan-detail">회원 30명 · 300MB</span>
        <span class="plan-price">₩1,900/월</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Coach50</span>
        <span class="plan-detail">회원 50명 · 500MB</span>
        <span class="plan-price">₩2,900/월</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Coach100</span>
        <span class="plan-detail">회원 100명 · 1GB</span>
        <span class="plan-price">₩5,900/월</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Premier200</span>
        <span class="plan-detail">회원 200명 · 5GB</span>
        <span class="plan-price">₩19,000/월</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Premier300</span>
        <span class="plan-detail">회원 300명 · 10GB</span>
        <span class="plan-price">₩27,000/월</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Premier500</span>
        <span class="plan-detail">회원 500명 · 20GB</span>
        <span class="plan-price">₩43,000/월</span>
      </div>
      <div class="plan-row">
        <span class="plan-name">Premier1000</span>
        <span class="plan-detail">회원 1,000명 · 50GB</span>
        <span class="plan-price">₩79,000/월</span>
      </div>
    </div>

    <p class="section-title">앱 다운로드</p>
    <div class="store-links">
      <a class="store-btn" href="https://apps.apple.com/app/id6761360360" target="_blank">🍎 App Store</a>
      <a class="store-btn" href="https://play.google.com/store/apps/details?id=com.swimnote.app" target="_blank">▶ Google Play</a>
    </div>

    <p class="section-title">서비스 정보</p>
    <div class="info-box">
      <div class="info-row"><span class="info-label">서비스명</span><span>SwimNote (스윔노트)</span></div>
      <div class="info-row"><span class="info-label">서비스 유형</span><span>수영장·코치 회원 관리 B2B SaaS</span></div>
      <div class="info-row"><span class="info-label">플랫폼</span><span>iOS / Android 앱</span></div>
      <div class="info-row"><span class="info-label">카카오 로그인</span><span>학부모 간편 가입 및 로그인 (카카오 계정 연동)</span></div>
      <div class="info-row"><span class="info-label">개인정보처리방침</span><span><a href="/api/privacy" style="color:#1565c0">보기</a></span></div>
    </div>
  </div>

  <div class="footer">© 2024 SwimNote. All rights reserved.</div>
</body>
</html>`);
});

// 404 핸들러 — HTML 대신 JSON
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "요청한 경로를 찾을 수 없습니다.", error: "Not Found" });
});

// 전역 에러 핸들러 — 프로덕션에서는 내부 메시지 노출 안 함
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Global Error]", err);
  const isProd = process.env.NODE_ENV === "production";
  res.status(500).json({
    success: false,
    message: isProd ? "서버 오류가 발생했습니다." : (err.message || "서버 오류가 발생했습니다."),
    error:   isProd ? "Internal Server Error"   : err.message,
  });
});

// 푸시 알림 시스템 초기화
initPushTables()
  .then(() => {
    startPushScheduler();
    console.log("[app] 푸시 알림 시스템 초기화 완료");
  })
  .catch(e => console.error("[app] 푸시 초기화 오류:", e));

export default app;
