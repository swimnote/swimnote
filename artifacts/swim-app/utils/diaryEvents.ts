/**
 * diaryEvents — 일지 생성/삭제 시 전 화면에 즉시 상태를 전파하는 경량 이벤트 버스
 *
 * 사용 패턴:
 *   emit: emitDiaryChanged({ type: "deleted", diaryId, classGroupId, lessonDate })
 *   subscribe: const unsub = onDiaryChanged(ev => { ... }); useEffect(() => unsub, []);
 */

export type DiaryChangedEvent = {
  type: "deleted" | "created";
  diaryId: string;
  classGroupId: string;
  lessonDate: string; // YYYY-MM-DD
};

type Listener = (event: DiaryChangedEvent) => void;
const listeners = new Set<Listener>();

export function emitDiaryChanged(event: DiaryChangedEvent): void {
  listeners.forEach(l => {
    try { l(event); } catch { /* 리스너 에러가 다른 리스너를 막지 않도록 */ }
  });
}

/** 구독 후 반환값(언서브 함수)을 useEffect cleanup으로 사용하세요. */
export function onDiaryChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
