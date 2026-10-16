import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useOfficeNavigation } from "./OfficeNavigation";
import "./OfficeWorkspace.css";

type Mode = "business" | "ai";
const Visibility = createContext(true);
export const useOfficeBusinessVisible = () => useContext(Visibility);
const defaults: Record<Mode, number> = { business: 360, ai: 480 };
const MIN_PANEL = 280;
const MIN_PRIMARY = 480;
const DIVIDER = 8;
const NARROW_AT = 800; // Provisional CSS-space recommendations, not verified Windows dimensions.

/** One persistent business subtree. Layout state and minimal Context never leave session memory. */
export function OfficeWorkspace({ children }: { children: ReactNode }) {
  const nav = useOfficeNavigation();
  const [mode, setMode] = useState<Mode>("business");
  const [panelOpen, setPanelOpen] = useState(false);
  const [preferred, setPreferred] = useState(defaults);
  const [available, setAvailable] = useState(0);
  const [narrowView, setNarrowView] = useState<Mode>("business");
  const root = useRef<HTMLDivElement>(null);
  const business = useRef<HTMLElement>(null);
  const safeControl = useRef<HTMLButtonElement>(null);
  const focusRegion = useRef<Mode | "divider" | null>(null);
  const pendingBusinessFocus = useRef(false);
  const drag = useRef<{ id: number; x: number; size: number; mode: Mode } | null>(null);
  const narrow = available < NARROW_AT;
  const maximum = Math.max(MIN_PANEL, available - MIN_PRIMARY - DIVIDER);
  const panelSize = Math.max(MIN_PANEL, Math.min(preferred[mode], maximum));
  const activeNarrow = panelOpen ? narrowView : mode;
  const businessVisible = narrow ? activeNarrow === "business" : mode === "business" || panelOpen;
  const aiVisible = narrow ? activeNarrow === "ai" : mode === "ai" || panelOpen;
  const sideVisible = mode === "ai" ? businessVisible : aiVisible;
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () => setAvailable(node.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useLayoutEffect(() => {
    if (pendingBusinessFocus.current && businessVisible) {
      pendingBusinessFocus.current = false;
      business.current?.focus();
    } else if ((focusRegion.current === "business" && !businessVisible) ||
               (focusRegion.current === "ai" && !aiVisible) ||
               (focusRegion.current === "divider" && (narrow || !panelOpen))) safeControl.current?.focus();
  }, [businessVisible, aiVisible, narrow, panelOpen]);
  function changeMode(next: Mode) {
    if (next === mode) return;
    drag.current = null;
    setMode(next); setPanelOpen(true); setNarrowView(next);
  }
  function togglePanel() {
    drag.current = null;
    if (narrow && !sideVisible) {
      setPanelOpen(true); setNarrowView(mode === "business" ? "ai" : "business");
      return;
    }
    setPanelOpen(!panelOpen);
    setNarrowView(panelOpen ? mode : mode === "business" ? "ai" : "business");
  }
  function resize(value: number) {
    setPreferred(current => ({ ...current, [mode]: Math.max(MIN_PANEL, Math.min(value, maximum)) }));
  }
  function returnToBusiness() {
    if (!nav?.open(nav.destination)) return;
    pendingBusinessFocus.current = true;
    setPanelOpen(true); setNarrowView("business");
    if (businessVisible) {
      pendingBusinessFocus.current = false;
      business.current?.focus();
    }
  }
  const panelLabel = mode === "ai" ? "Side Workspace" : "AI 영역";
  return <div ref={root} className="office-workspace" data-mode={mode}
    data-business-visible={businessVisible} data-ai-visible={aiVisible} data-narrow={narrow}
    onFocusCapture={event => {
      const element = event.target as HTMLElement;
      focusRegion.current = element.closest(".office-workspace-business") ? "business"
        : element.closest(".office-workspace-ai") ? "ai"
          : element.closest(".office-workspace-divider") ? "divider" : null;
    }}
    style={{ "--office-panel-size": `${panelSize}px` } as React.CSSProperties}>
    <div className="office-workspace-toolbar" data-office-navigation aria-label="업무 배치">
      <div role="group" aria-label="배치 모드">
        <button ref={safeControl} aria-pressed={mode === "business"} onClick={() => changeMode("business")}>업무집중</button>
        <button aria-pressed={mode === "ai"} onClick={() => changeMode("ai")}>AI 중심</button>
      </div>
      <button aria-expanded={sideVisible} aria-controls={mode === "ai" ? "office-business-region" : "office-ai-region"}
        onClick={togglePanel}>{panelLabel} {sideVisible ? "접기" : "열기"}</button>
      {!narrow && panelOpen && <button onClick={() => setPreferred(current => ({ ...current, [mode]: defaults[mode] }))}>패널 기본 크기</button>}
      {narrow && panelOpen && <div role="group" aria-label="좁은 창 표시 영역">
        <button aria-pressed={businessVisible} onClick={returnToBusiness}>현재 업무 보기</button>
        <button aria-pressed={aiVisible} onClick={() => setNarrowView("ai")}>AI 영역 보기</button>
      </div>}
    </div>
    <div className="office-workspace-panes">
      <section ref={business} id="office-business-region" className="office-workspace-business"
        aria-label="현재 업무 화면" tabIndex={-1} hidden={!businessVisible} inert={!businessVisible}>
        <Visibility.Provider value={businessVisible}>
          <div className="office-workspace-scroll" data-office-business-scroll>{children}</div>
        </Visibility.Provider>
      </section>
      <div className="office-workspace-divider" data-office-navigation
        hidden={narrow || !panelOpen} role="separator" tabIndex={0} aria-label={`${panelLabel} 크기 조절`}
        aria-orientation="vertical" aria-controls={mode === "ai" ? "office-business-region" : "office-ai-region"}
        aria-valuemin={MIN_PANEL} aria-valuemax={maximum} aria-valuenow={panelSize}
        aria-valuetext={`${Math.round(panelSize)} CSS 픽셀`}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          resize(event.key === "Home" ? MIN_PANEL : event.key === "End" ? maximum
            : panelSize + (event.key === "ArrowLeft" ? 24 : -24));
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, size: panelSize, mode };
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (start && start.id === event.pointerId && start.mode === mode) resize(start.size + start.x - event.clientX);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }} />
      <section id="office-ai-region" className="office-workspace-ai" data-office-navigation
        aria-label="AI 연결 준비 영역" hidden={!aiVisible} inert={!aiVisible}>
        <h2 className="office-workspace-ai-heading">AI 작업창 · 연결 전</h2>
        <p className="office-workspace-empty">아직 AI가 연결되지 않았습니다. 대화 전송·모델 호출·업무 실행은 제공하지 않습니다.</p>
        <dl className="office-workspace-context">
          <dt>현재 화면</dt><dd>{nav?.destination.screen === "members" ? "회원목록" : "홈 현황"}</dd>
          <dt>선택 대상 ID</dt><dd>{nav?.destination.screen === "members" ? nav.destination.memberId ?? "선택 없음" : "선택 없음"}</dd>
        </dl>
        <button onClick={returnToBusiness}>현재 업무로 돌아가기</button>
        <p>화면 열기는 업무 처리 완료가 아닙니다. Context는 외부로 전송하지 않습니다.</p>
      </section>
    </div>
  </div>;
}
