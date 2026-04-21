import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface DebugLogEntry {
  id: number;
  time: string;
  level: "log" | "warn" | "error";
  msg: string;
}

interface DebugLogContextValue {
  logs: DebugLogEntry[];
  isVisible: boolean;
  showOverlay: () => void;
  hideOverlay: () => void;
  toggleOverlay: () => void;
  clearLogs: () => void;
  tapCount: number;
  handleHiddenTap: () => void;
}

const DebugLogContext = createContext<DebugLogContextValue>({
  logs: [],
  isVisible: false,
  showOverlay: () => {},
  hideOverlay: () => {},
  toggleOverlay: () => {},
  clearLogs: () => {},
  tapCount: 0,
  handleHiddenTap: () => {},
});

const FILTER_KEYWORDS = [
  "[AUTH COMPLETE]",
  "[AppleLogin]",
  "[KakaoLogin]",
  "[GoogleLogin]",
  "[setAdminSession]",
  "[POOL FETCH FAIL]",
  "[FONT]",
  "[BUILD_TAG]",
  "[LAYOUT]",
];

function shouldCapture(msg: string): boolean {
  return FILTER_KEYWORDS.some((kw) => msg.includes(kw));
}

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return _idCounter;
}

function formatArgs(args: any[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function nowTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

const MAX_LOGS = 300;
const HIDDEN_TAP_THRESHOLD = 5;
const TAP_RESET_MS = 2000;

export function DebugLogProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback(
    (level: DebugLogEntry["level"], msg: string) => {
      if (!shouldCapture(msg)) return;
      const entry: DebugLogEntry = { id: nextId(), time: nowTime(), level, msg };
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
      });
    },
    []
  );

  useEffect(() => {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = (...args: any[]) => {
      origLog(...args);
      addLog("log", formatArgs(args));
    };
    console.warn = (...args: any[]) => {
      origWarn(...args);
      addLog("warn", formatArgs(args));
    };
    console.error = (...args: any[]) => {
      origError(...args);
      addLog("error", formatArgs(args));
    };

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    };
  }, [addLog]);

  const showOverlay = useCallback(() => setIsVisible(true), []);
  const hideOverlay = useCallback(() => setIsVisible(false), []);
  const toggleOverlay = useCallback(() => setIsVisible((v) => !v), []);
  const clearLogs = useCallback(() => setLogs([]), []);

  const handleHiddenTap = useCallback(() => {
    setTapCount((prev) => {
      const next = prev + 1;
      if (tapTimer.current) clearTimeout(tapTimer.current);
      if (next >= HIDDEN_TAP_THRESHOLD) {
        setIsVisible((v) => !v);
        tapTimer.current = setTimeout(() => setTapCount(0), TAP_RESET_MS);
        return 0;
      }
      tapTimer.current = setTimeout(() => setTapCount(0), TAP_RESET_MS);
      return next;
    });
  }, []);

  return (
    <DebugLogContext.Provider
      value={{
        logs,
        isVisible,
        showOverlay,
        hideOverlay,
        toggleOverlay,
        clearLogs,
        tapCount,
        handleHiddenTap,
      }}
    >
      {children}
    </DebugLogContext.Provider>
  );
}

export function useDebugLog() {
  return useContext(DebugLogContext);
}
