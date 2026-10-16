import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { addLocalFiles, type LocalAttachment } from "./local-attachments";

export const MANAGER_DEFAULT_HEIGHT = 392;

export type OfficeManagerValue = {
  expanded: boolean;
  large: boolean;
  preferredHeight: number;
  draft: string;
  attachments: LocalAttachment[];
  attachmentErrors: string[];
  focusToken: number;
  /** Expand the manager and request focus on the existing textarea. No navigation. */
  activate: () => void;
  setExpanded: (v: boolean) => void;
  setLarge: (v: boolean) => void;
  setPreferredHeight: (h: number) => void;
  setDraft: (v: string) => void;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  clearErrors: () => void;
};

const Ctx = createContext<OfficeManagerValue | null>(null);


/** Session-memory state only. Sits above DashboardLayout so business consumers are never remounted. */
export function OfficeManagerProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const [large, setLarge] = useState(false);
  const [preferredHeight, setPreferredHeight] = useState(MANAGER_DEFAULT_HEIGHT);
  const [draft, setDraft] = useState("");
  const [{ attachments, attachmentErrors }, setSelection] = useState<{
    attachments: LocalAttachment[]; attachmentErrors: string[];
  }>({ attachments: [], attachmentErrors: [] });
  const [focusToken, setFocusToken] = useState(0);

  const activate = useCallback(() => { setExpanded(true); setFocusToken(t => t + 1); }, []);
  const addFiles = useCallback((files: File[]) => {
    setSelection(cur => {
      const { next, errors } = addLocalFiles(cur.attachments, files);
      return { attachments: next, attachmentErrors: errors };
    });
  }, []);
  const removeFile = useCallback((id: string) => {
    setSelection(c => ({ attachments: c.attachments.filter(a => a.id !== id), attachmentErrors: [] }));
  }, []);
  const clearErrors = useCallback(() => setSelection(c => ({ ...c, attachmentErrors: [] })), []);

  const value = useMemo<OfficeManagerValue>(() => ({
    expanded, large, preferredHeight, draft, attachments, attachmentErrors, focusToken,
    activate, setExpanded, setLarge, setPreferredHeight, setDraft, addFiles, removeFile, clearErrors,
  }), [expanded, large, preferredHeight, draft, attachments, attachmentErrors, focusToken, activate, addFiles, removeFile, clearErrors]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfficeManager() {
  return useContext(Ctx);
}
