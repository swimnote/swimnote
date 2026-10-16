import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useRealtime } from "./RealtimeContext";
import type { EditLease } from "./realtime-sync";

/** Opt-in shared protection. Screens still need their own server revision check on save. */
export function useRealtimeDraft<T>(key: QueryKey, serverValue: T) {
  const { coordinator } = useRealtime();
  const [draft, setValue] = useState(serverValue);
  const [dirty, setDirty] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const previous = useRef(serverValue);
  const scope = JSON.stringify(key);
  useLayoutEffect(() => {
    if (!dirty || !coordinator) return;
    const lease: EditLease = { key: JSON.parse(scope), changed: false,
      notify: () => setRemoteChanged(true) };
    return coordinator.edit(lease);
  }, [coordinator, dirty, scope]);
  useEffect(() => {
    if (dirty && !Object.is(previous.current, serverValue)) setRemoteChanged(true);
    if (!dirty) setValue(serverValue);
    previous.current = serverValue;
  }, [dirty, serverValue]);
  return {
    draft, dirty, remoteChanged,
    setDraft(value: T) { setDirty(true); setValue(value); },
    // Explicitly discard/reload only; never claim a revision-safe save.
    discardAndRefresh() { setRemoteChanged(false); setDirty(false); },
  };
}
