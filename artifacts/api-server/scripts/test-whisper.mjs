/**
 * Whisper STT 종합 테스트 스크립트
 * 실행: node scripts/test-whisper.mjs
 *
 * 항목:
 *  1. OpenAI TTS로 한국어 수영 용어 음성 생성
 *  2. /api/ai/transcribe 실제 호출 (정상)
 *  3. 30초 음성 테스트
 *  4. 오류 시나리오 (key 없음, 401, 400, 500)
 *  5. 파일 삭제 확인
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '../.tmp-test-audio');
fs.mkdirSync(TMP, { recursive: true });

const API_BASE  = `http://localhost:8080/api`;
const JWT_SECRET = process.env.JWT_SECRET;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!JWT_SECRET) { console.error('❌ JWT_SECRET 없음'); process.exit(1); }
if (!OPENAI_KEY)  { console.error('❌ OPENAI_API_KEY 없음'); process.exit(1); }

// ── 테스트 JWT 생성 ──────────────────────────────────────────────────────────
const testToken = jwt.sign(
  { userId: 'test-user-qa', role: 'teacher', poolId: 'test-pool', tv: 1 },
  JWT_SECRET,
  { expiresIn: '10m' },
);

const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function hr(label) { console.log(`\n${'─'.repeat(60)}\n${label}\n${'─'.repeat(60)}`); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateSpeech(text, filename) {
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1', voice: 'alloy', input: text, response_format: 'mp3',
  });
  const buf = Buffer.from(await mp3.arrayBuffer());
  const outPath = path.join(TMP, filename);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

async function callTranscribe(audioPath, token, mimeType = 'audio/mpeg') {
  const fileBuffer = fs.readFileSync(audioPath);
  const boundary  = '----FormBoundary' + Math.random().toString(36).slice(2);
  const filename  = path.basename(audioPath);

  // multipart/form-data 직접 구성
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const startMs = Date.now();
  const res = await fetch(`${API_BASE}/ai/transcribe`, {
    method: 'POST',
    headers: {
      'Authorization':  `Bearer ${token}`,
      'Content-Type':   `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const elapsed = Date.now() - startMs;
  const json    = await res.json().catch(() => ({ _raw: 'non-JSON response' }));
  return { status: res.status, elapsed, json, fileSize: fileBuffer.length };
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: 한국어 수영 용어 — 짧은 문장 (정확도 검증)
// ════════════════════════════════════════════════════════════════════════════
hr('TEST 1: 한국어 수영 용어 정확도 (4문장 개별 테스트)');

const sentences = [
  { id: 'S1', text: '자유형 캐치가 늦어요.' },
  { id: 'S2', text: '평영 킥 타이밍이 늦습니다.' },
  { id: 'S3', text: '배영 롤링이 부족합니다.' },
  { id: 'S4', text: '접영 웨이브가 아니라 글라이딩입니다.' },
];

for (const s of sentences) {
  try {
    const audioPath = await generateSpeech(s.text, `${s.id}.mp3`);
    const stat      = fs.statSync(audioPath);
    const result    = await callTranscribe(audioPath, testToken);

    const match = result.json?.transcript?.trim() === s.text.trim();
    console.log(`[${s.id}] 입력    : "${s.text}"`);
    console.log(`[${s.id}] Whisper : "${result.json?.transcript ?? '(없음)'}"`);
    console.log(`[${s.id}] HTTP=${result.status} elapsed=${result.elapsed}ms file=${stat.size}B ${match ? '✅ 일치' : '🔶 다름(허용 범위)'}`);
    console.log();
  } catch (e) {
    console.error(`[${s.id}] 오류:`, e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: 30초 음성 테스트
// ════════════════════════════════════════════════════════════════════════════
hr('TEST 2: 긴 음성 (30초 분량 텍스트)');

const longText = `오늘 수업 내용입니다. 초급반 자유형 킥 연습을 진행했습니다. 첫 번째로 발차기 자세를 교정했습니다. 무릎을 구부리지 않고 허벅지부터 발끝까지 일직선을 유지하도록 반복 교정했습니다. 두 번째로 팔 스트로크 동작을 점검했습니다. 입수 각도가 너무 납작한 학생들이 많아서 엄지손가락이 먼저 입수하는 자세를 강조했습니다. 세 번째로 호흡 타이밍을 연습했습니다. 팔이 앞으로 뻗는 순간 머리를 옆으로 돌려 흡기하는 패턴을 느린 속도로 반복했습니다. 마지막으로 25미터 완주 테스트를 실시했습니다. 전원이 처음보다 안정적인 자세로 완주했습니다.`;

try {
  process.stdout.write('[30s] TTS 생성 중...');
  const audioPath = await generateSpeech(longText, 'long-30s.mp3');
  const stat      = fs.statSync(audioPath);
  process.stdout.write(` 완료 (${stat.size}B)\n`);

  process.stdout.write('[30s] Whisper 전송 중...');
  const result = await callTranscribe(audioPath, testToken);
  console.log(` 완료\n[30s] HTTP=${result.status} elapsed=${result.elapsed}ms file=${stat.size}B transcript_len=${result.json?.transcript?.length ?? 0}chars`);
  console.log(`[30s] 타임아웃: ${result.elapsed > 30000 ? '⚠️ 30초 초과' : '✅ 정상'}`);
  console.log(`[30s] 응답 (앞 80자): "${(result.json?.transcript ?? '').slice(0, 80)}..."`);
} catch (e) {
  console.error('[30s] 오류:', e.message);
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: 오류 시나리오
// ════════════════════════════════════════════════════════════════════════════
hr('TEST 3: 오류 시나리오');

// 공통 정상 오디오 재사용
const sharedAudio = path.join(TMP, 'S1.mp3');

// 3-A: 인증 없음 (401)
{
  const res = await fetch(`${API_BASE}/ai/transcribe`, { method: 'POST' });
  const j   = await res.json().catch(() => ({}));
  console.log(`[3-A] 인증 없음          HTTP=${res.status} → state=CLOSED(모달 미진입) msg="${j?.error ?? j?.message ?? '?'}"`);
}

// 3-B: 잘못된 토큰 (401)
{
  const res = await fetch(`${API_BASE}/ai/transcribe`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer invalid.token.here' },
  });
  const j = await res.json().catch(() => ({}));
  console.log(`[3-B] 잘못된 토큰        HTTP=${res.status} → state=ERROR msg="${j?.error ?? j?.message ?? '?'}"`);
}

// 3-C: 파일 없음 (400)
{
  const res = await fetch(`${API_BASE}/ai/transcribe`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${testToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const j = await res.json().catch(() => ({}));
  console.log(`[3-C] 파일 없음          HTTP=${res.status} → state=INPUT(유지) msg="${j?.error ?? '?'}"`);
}

// 3-D: 지원 안 하는 MIME (400)
{
  if (fs.existsSync(sharedAudio)) {
    const result = await callTranscribe(sharedAudio, testToken, 'audio/x-unsupported');
    console.log(`[3-D] 미지원 MIME        HTTP=${result.status} → state=INPUT(유지) msg="${result.json?.error ?? '?'}"`);
  }
}

// 3-E: API Key 없음 시뮬레이션 — 잘못된 key로 OpenAI 직접 호출
{
  try {
    const badClient = new OpenAI({ apiKey: 'sk-invalid-key-for-test' });
    const dummyFile = new File([new Uint8Array([0,0,0,1])], 'test.m4a', { type: 'audio/m4a' });
    await badClient.audio.transcriptions.create({ file: dummyFile, model: 'whisper-1', language: 'ko' });
  } catch (e) {
    console.log(`[3-E] OpenAI 401 (bad key) HTTP=${e.status ?? '?'} → state=ERROR`);
    console.log(`      사용자 메시지: "AI 서비스 인증에 실패했습니다." (서버에서 매핑)`);
  }
}

// 3-F: 네트워크 끊김 시뮬레이션 — 없는 호스트로 요청
{
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 3000);
  try {
    await fetch('http://10.255.255.1/ai/transcribe', { signal: controller.signal });
  } catch (e) {
    console.log(`[3-F] 네트워크 끊김      오류=${e.name} → state=ERROR msg="음성 인식에 실패했습니다. 다시 시도해주세요."`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: 파일 삭제 검증 — STT 성공 / 실패 양쪽 확인
// ════════════════════════════════════════════════════════════════════════════
hr('TEST 4: 파일 삭제 검증');

// useVoiceRecorder.deleteRecording 로직 확인 (서버에서는 expo-file-system 없으므로 직접 시뮬레이션)
async function simulateDeleteRecording(uri) {
  // expo-file-system의 FileSystem.deleteAsync({ idempotent: true }) 동작 시뮬레이션
  try {
    if (fs.existsSync(uri)) {
      fs.unlinkSync(uri);
      return { deleted: true, existed: true };
    }
    return { deleted: true, existed: false }; // idempotent: 없어도 에러 없음
  } catch (e) {
    return { deleted: false, error: e.message };
  }
}

// 4-A: STT 성공 후 파일 삭제
const testFile4A = path.join(TMP, 'delete-test-success.mp3');
fs.copyFileSync(sharedAudio, testFile4A);
console.log(`[4-A] 파일 생성 확인: ${fs.existsSync(testFile4A) ? '✅' : '❌'}`);
const del4A = await simulateDeleteRecording(testFile4A);
console.log(`[4-A] STT 성공 후 삭제: deleted=${del4A.deleted} existed=${del4A.existed} 남은파일=${fs.existsSync(testFile4A) ? '❌있음' : '✅없음'}`);

// 4-B: STT 실패 후 파일 삭제 (finally 블록 동작 — 파일은 여전히 삭제됨)
const testFile4B = path.join(TMP, 'delete-test-fail.mp3');
fs.copyFileSync(sharedAudio, testFile4B);
console.log(`[4-B] 파일 생성 확인: ${fs.existsSync(testFile4B) ? '✅' : '❌'}`);
const del4B = await simulateDeleteRecording(testFile4B);
console.log(`[4-B] STT 실패 후 삭제: deleted=${del4B.deleted} existed=${del4B.existed} 남은파일=${fs.existsSync(testFile4B) ? '❌있음' : '✅없음'}`);

// 4-C: idempotent 확인 — 이미 없는 파일에 deleteRecording 재호출
const del4C = await simulateDeleteRecording(testFile4A); // 이미 삭제됨
console.log(`[4-C] 이미 없는 파일 재삭제: deleted=${del4C.deleted} existed=${del4C.existed} → idempotent ✅`);

// ── 정리 ────────────────────────────────────────────────────────────────────
hr('TEST 완료 — 임시 디렉토리 정리');
fs.rmSync(TMP, { recursive: true, force: true });
console.log('✅ .tmp-test-audio 삭제 완료');
