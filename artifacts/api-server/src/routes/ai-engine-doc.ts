import { Router } from "express";

const router = Router();

const DOC_CONTENT = `# SWIMNOTE AI ENGINE — 초기 세팅 설계서

## 프로젝트 개요
수영 전용 AI 지식 데이터베이스를 구축한다.
GPT 연결은 나중에 한다. 지금은 완벽한 DB 구조 세팅이 목표.
PostgreSQL + Express(Node.js) 서버.
데이터를 텍스트로 붙여넣으면 자동으로 분류해서 DB에 저장하는 구조.

---

## 1. DB 스키마 (전체 생성)

### knowledge_chunks (핵심 지식 테이블)
\`\`\`sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_chunks (
  id              SERIAL PRIMARY KEY,
  chunk_id        TEXT UNIQUE NOT NULL,
  version         INTEGER DEFAULT 1,

  -- 분류 체계
  domain          TEXT NOT NULL,
  sub_domain      TEXT,
  topic           TEXT,

  -- 대상/난이도
  target_level    TEXT CHECK (target_level IN ('초급','중급','고급','전문')),
  target_audience TEXT CHECK (target_audience IN ('소아','성인','시니어','선수','학부모','지도자')),
  context_type    TEXT CHECK (context_type IN ('교정','설명','칭찬','주의','상담','훈련')),

  -- 10가지 관점 (고정)
  viewpoint       TEXT CHECK (viewpoint IN ('자세','호흡','타이밍','힘','속도','리듬','안전','심리','체력','기술')),

  -- 내용
  content         TEXT NOT NULL,
  content_detail  TEXT,
  keywords        TEXT[],

  -- 출처
  source_type     TEXT CHECK (source_type IN ('manual','book','paper','question_derived','web')),
  source_ref      TEXT,

  -- 상태
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','deprecated','under_review')),
  confidence      FLOAT DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  conflict_flag   BOOLEAN DEFAULT FALSE,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_domain ON knowledge_chunks(domain);
CREATE INDEX idx_chunks_level ON knowledge_chunks(target_level);
CREATE INDEX idx_chunks_audience ON knowledge_chunks(target_audience);
CREATE INDEX idx_chunks_viewpoint ON knowledge_chunks(viewpoint);
CREATE INDEX idx_chunks_status ON knowledge_chunks(status);
\`\`\`

### knowledge_versions (버전 이력 — 기존 내용 영구 보존)
\`\`\`sql
CREATE TABLE knowledge_versions (
  id          SERIAL PRIMARY KEY,
  chunk_id    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  reason      TEXT,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

### ingestion_queue (데이터 입력 처리 큐)
\`\`\`sql
CREATE TABLE ingestion_queue (
  id             SERIAL PRIMARY KEY,
  raw_text       TEXT NOT NULL,
  source_type    TEXT,
  source_ref     TEXT,
  status         TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  result_chunks  INTEGER[],
  chunk_count    INTEGER DEFAULT 0,
  error_msg      TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);
\`\`\`

### conflict_reviews (충돌 검토 대기열)
\`\`\`sql
CREATE TABLE conflict_reviews (
  id                SERIAL PRIMARY KEY,
  existing_chunk_id TEXT,
  new_content       TEXT,
  conflict_reason   TEXT,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','keep','replace','merge')),
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

### query_logs (질문 자동 학습 — 나중에 GPT 연결 후 활성화)
\`\`\`sql
CREATE TABLE query_logs (
  id               SERIAL PRIMARY KEY,
  session_id       TEXT,
  question         TEXT NOT NULL,
  detected_domain  TEXT,
  retrieved_chunks INTEGER[],
  answer           TEXT,
  feedback_score   INTEGER CHECK (feedback_score BETWEEN 1 AND 5),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

### knowledge_gaps (지식 공백 추적)
\`\`\`sql
CREATE TABLE knowledge_gaps (
  id           SERIAL PRIMARY KEY,
  question     TEXT NOT NULL,
  gap_reason   TEXT,
  frequency    INTEGER DEFAULT 1,
  status       TEXT DEFAULT 'open' CHECK (status IN ('open','filled','wont_fix')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
\`\`\`

---

## 2. API 엔드포인트

### 데이터 입력 (수동 분류 — GPT 없이 직접 JSON으로 삽입)
POST /api/ingest/manual
  body: {
    domain: "자유형",
    sub_domain: "팔동작",
    topic: "풀 단계",
    target_level: "초급",
    target_audience: "소아",
    context_type: "교정",
    viewpoint: "자세",
    content: "팔꿈치를 높게 유지하며 물을 뒤로 밀어주세요.",
    content_detail: "상세 설명 (선택)",
    keywords: ["팔꿈치", "풀동작"],
    source_type: "book",
    source_ref: "책 제목"
  }

### 텍스트 원문 입력 (큐에 적재 — 나중에 GPT 자동 분류)
POST /api/ingest/raw
  body: { text: "원문 텍스트", source_type: "book", source_ref: "출처명" }

### 지식 검색
GET /api/knowledge?domain=자유형&level=초급&viewpoint=자세&audience=소아

### 지식 단건 조회
GET /api/knowledge/:chunk_id

### 지식 수정
PUT /api/knowledge/:chunk_id
  body: { content: "수정된 내용", reason: "이론 업데이트" }
  → 기존 버전은 knowledge_versions에 자동 보존

### 지식 비활성화 (삭제 대신)
DELETE /api/knowledge/:chunk_id
  → status='deprecated' 처리, 실제 삭제 안 함

### 충돌 목록 조회
GET /api/conflicts

### 충돌 해결
POST /api/conflicts/:id/resolve
  body: { action: "keep" | "replace" | "merge" }

### 전체 통계
GET /api/stats
  → 총 chunk 수, 도메인별 분포, 충돌 대기 수, 공백 수

---

## 3. 도메인 분류 체계 (초기값 — 확장 가능)

대분류(domain):
- 자유형 / 배영 / 평영 / 접영
- 개인혼영 / 혼영계영
- 출발·턴
- 유아수영
- 재활수영
- 성인수영
- 선수훈련
- 수영안전
- 지도법
- 학부모상담
- 수영장운영

---

## 4. 기술 스택
- Runtime: Node.js (Express + TypeScript)
- DB: PostgreSQL
- 환경변수: DATABASE_URL

## 5. 시작 순서
1. PostgreSQL 연결 확인
2. 위 스키마 전체 생성 (마이그레이션)
3. POST /api/ingest/manual 구현 및 테스트
4. GET /api/knowledge 검색 구현
5. 관리자 대시보드 (통계, 충돌 검토)
6. (나중에) GPT-4o mini 연결 → /api/ingest/raw 자동 분류 활성화`;

router.get("/ai-engine-doc", (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SWIMNOTE AI ENGINE 설계서</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header h1 {
      font-size: 24px;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .header p {
      color: #888;
      font-size: 14px;
    }
    .copy-btn {
      display: block;
      width: 100%;
      padding: 16px;
      background: #2563eb;
      color: white;
      font-size: 17px;
      font-weight: 700;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      margin-bottom: 24px;
      transition: background 0.2s;
    }
    .copy-btn:hover { background: #1d4ed8; }
    .copy-btn.copied { background: #16a34a; }
    .usage {
      background: #1a1f2e;
      border: 1px solid #2a3050;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .usage h2 { font-size: 14px; color: #60a5fa; margin-bottom: 12px; }
    .usage ol { padding-left: 20px; }
    .usage li { font-size: 13px; color: #aaa; margin-bottom: 6px; line-height: 1.6; }
    .usage li strong { color: #e0e0e0; }
    .doc-box {
      background: #1a1f2e;
      border: 1px solid #2a3050;
      border-radius: 12px;
      padding: 24px;
    }
    .doc-box h2 { font-size: 14px; color: #888; margin-bottom: 16px; }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Menlo', 'Monaco', monospace;
      font-size: 12px;
      line-height: 1.7;
      color: #c8d3f0;
    }
    .badge {
      display: inline-block;
      background: #14532d;
      color: #4ade80;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 20px;
      margin-left: 8px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏊 SWIMNOTE AI ENGINE</h1>
      <p>새 Replit 에이전트에게 보낼 초기 세팅 설계서</p>
    </div>

    <button class="copy-btn" onclick="copyDoc()" id="copyBtn">
      📋 전체 설계서 복사하기
    </button>

    <div class="usage">
      <h2>📌 사용 방법</h2>
      <ol>
        <li><strong>위 버튼</strong>으로 설계서 전체 복사</li>
        <li>Replit에서 <strong>새 프로젝트 생성</strong> → Website 선택</li>
        <li>새 에이전트 첫 메시지에 <strong>복사한 내용 붙여넣기</strong></li>
        <li>에이전트가 DB 스키마 생성 + API 구축 시작</li>
        <li>완료 후 <strong>데이터 텍스트 전달</strong> → 자동 분류 저장</li>
      </ol>
    </div>

    <div class="doc-box">
      <h2>설계서 내용 미리보기 <span class="badge">복사 가능</span></h2>
      <pre id="docContent">${DOC_CONTENT.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
    </div>
  </div>

  <script>
    const rawDoc = ${JSON.stringify(DOC_CONTENT)};

    function copyDoc() {
      navigator.clipboard.writeText(rawDoc).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.textContent = '✅ 복사 완료!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 전체 설계서 복사하기';
          btn.classList.remove('copied');
        }, 2500);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = rawDoc;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const btn = document.getElementById('copyBtn');
        btn.textContent = '✅ 복사 완료!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '📋 전체 설계서 복사하기';
          btn.classList.remove('copied');
        }, 2500);
      });
    }
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export default router;
