/**
 * responseTracker — 응답 시간 추적 유틸리티
 * 슈퍼관리자 서버 느려짐 감지용
 */

const WINDOW_SIZE = 100;
const responseTimes: number[] = [];

export function recordResponseTime(ms: number): void {
  responseTimes.push(ms);
  if (responseTimes.length > WINDOW_SIZE) {
    responseTimes.shift();
  }
}

export function getAverageResponseTime(): number {
  if (responseTimes.length === 0) return 0;
  return responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
}

export function getResponseTimeStats(): { avg: number; max: number; count: number } {
  if (responseTimes.length === 0) return { avg: 0, max: 0, count: 0 };
  const avg = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const max = Math.max(...responseTimes);
  return { avg: Math.round(avg), max, count: responseTimes.length };
}
