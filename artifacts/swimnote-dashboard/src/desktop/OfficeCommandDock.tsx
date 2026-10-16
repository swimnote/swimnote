import { useEffect, useId, useRef, useState } from "react";

/** Future common Action boundary. Not connected: no submit handler exists yet. */
export type OfficeCommandAction = { type: "command"; text: string };
export type OfficeCommandHandler = (action: OfficeCommandAction) => void;

/** Persistent dock. Draft lives in component state only (session memory); keyed provider resets it. */
export function OfficeCommandDock() {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let timer: number | undefined;
    const retainNavigationFocus = (event: PointerEvent) => {
      const node = input.current;
      if (!node || document.activeElement !== node || !(event.target instanceof Element) ||
          !event.target.closest("aside, [data-office-navigation]") || event.target.closest(".office-dock")) return;
      const start = node.selectionStart, end = node.selectionEnd;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!node.isConnected) return;
        node.focus({ preventScroll: true });
        node.setSelectionRange(start, end);
      }, 0);
    };
    document.addEventListener("pointerdown", retainNavigationFocus, true);
    return () => {
      document.removeEventListener("pointerdown", retainNavigationFocus, true);
      window.clearTimeout(timer);
    };
  }, []);
  const id = useId();
  const reason = `${id}-reason`;
  return <section className="office-dock" data-office-navigation aria-label="AI 업무 입력">
    <div className="office-dock-log" role="log" aria-live="off" tabIndex={0} aria-label="AI 업무 처리 영역">
      <p className="office-dock-status">AI 연결 전 · 처리 결과가 없습니다.</p>
      <p className="office-dock-hint">입력은 이 창을 닫을 때까지 임시로만 유지됩니다. 모델 호출과 업무 실행은 제공하지 않습니다.</p>
    </div>
    <form className="office-dock-form" onSubmit={event => {
      event.preventDefault();
    }}>
      <textarea ref={input} className="office-dock-input" rows={2} value={draft} aria-label="업무 입력"
        aria-describedby={reason} placeholder="업무 내용을 입력하세요 (아직 전송되지 않습니다)"
        onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled aria-describedby={reason}>전송</button>
      <p id={reason} className="office-dock-reason">전송 불가: AI가 아직 연결되지 않았습니다.</p>
    </form>
  </section>;
}
