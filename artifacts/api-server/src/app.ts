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
