/**
 * tabReset.ts
 * 경량 pub/sub: 같은 탭 재탭 시 루트 화면에게 스크롤 초기화 신호를 보냄
 */
type Callback = () => void;
const _listeners = new Map<string, Set<Callback>>();

export function emitTabReset(tabName: string) {
  _listeners.get(tabName)?.forEach(cb => cb());
}

export function addTabResetListener(tabName: string, cb: Callback): () => void {
  if (!_listeners.has(tabName)) _listeners.set(tabName, new Set());
  _listeners.get(tabName)!.add(cb);
  return () => { _listeners.get(tabName)?.delete(cb); };
}
