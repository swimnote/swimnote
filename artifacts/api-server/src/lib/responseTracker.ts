/**
 * responseTracker.ts — API 응답시간 인메모리 슬라이딩 윈도우
 *
 * 최근 5분 내 응답시간을 메모리에 저장.
 * 서버 느려짐 감지에 사용합니다.
 */

const WINDOW_MS = 5 * 60 * 1000; // 5분

interface TimedEntry {
  ts: number;
  ms: number;
}

const responseTimes: TimedEntry[] = [];

export function recordResponseTime(ms: number): void {
  const now = Date.now();
  responseTimes.push({ ts: now, ms });
  // 5분 이전 항목 제거
  while (responseTimes.length > 0 && responseTimes[0].ts < now - WINDOW_MS) {
    responseTimes.shift();
  }
}

export function getRecentAvgResponseMs(): { avg: number; count: number } {
  const now = Date.now();
  const recent = responseTimes.filter(e => e.ts >= now - WINDOW_MS);
  if (recent.length === 0) return { avg: 0, count: 0 };
  const avg = recent.reduce((sum, e) => sum + e.ms, 0) / recent.length;
  return { avg: Math.round(avg), count: recent.length };
}
