import { createContext, useContext, type ReactNode } from "react";
import { OfficeCommandDock } from "./OfficeCommandDock";
import "./OfficeWorkspace.css";

const Visibility = createContext(true);
export const useOfficeBusinessVisible = () => useContext(Visibility);

/** One persistent business subtree above a persistent command dock. */
export function OfficeWorkspace({ children }: { children: ReactNode }) {
  return <div className="office-workspace">
    <section id="office-business-region" className="office-workspace-business" aria-label="현재 업무 화면">
      <Visibility.Provider value={true}>
        <div className="office-workspace-scroll" data-office-business-scroll>{children}</div>
      </Visibility.Provider>
    </section>
    <OfficeCommandDock />
  </div>;
}
