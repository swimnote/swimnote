import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { OfficeCommandDock } from "./OfficeCommandDock";
import "./OfficeWorkspace.css";

const Visibility = createContext(true);
export const useOfficeBusinessVisible = () => useContext(Visibility);

/** One persistent business subtree above a persistent manager card. Dock height is derived, never remounts business. */
export function OfficeWorkspace({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    setAvailable(node.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAvailable(node.clientHeight));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return <div ref={root} className="office-workspace">
    <section id="office-business-region" className="office-workspace-business" aria-label="현재 업무 화면">
      <Visibility.Provider value={true}>
        <div className="office-workspace-scroll" data-office-business-scroll>{children}</div>
      </Visibility.Provider>
    </section>
    <OfficeCommandDock available={available} />
  </div>;
}
