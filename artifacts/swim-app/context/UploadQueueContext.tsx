/**
 * UploadQueueContext — 백그라운드 사진 업로드 큐
 *
 * 사진 압축 후 큐에 추가(addJobs)하면 백그라운드에서 순차 업로드.
 * 화면 이동 시에도 업로드가 계속 진행됨.
 */
import React, { createContext, useContext, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/context/AuthContext";

export interface PhotoUploadJob {
  uri: string;
  endpoint: string;          // e.g. "/photos/group" | "/photos/private"
  params: Record<string, string>; // class_id, student_id, etc.
  token: string;
}

interface UploadQueueState {
  pending: number;
  done: number;
  failed: number;
}

interface UploadQueueContextValue {
  addJobs: (jobs: PhotoUploadJob[]) => void;
  state: UploadQueueState;
}

const UploadQueueContext = createContext<UploadQueueContextValue>({
  addJobs: () => {},
  state: { pending: 0, done: 0, failed: 0 },
});

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const queueRef = useRef<PhotoUploadJob[]>([]);
  const runningRef = useRef(false);
  const [state, setState] = useState<UploadQueueState>({ pending: 0, done: 0, failed: 0 });

  const runNext = useCallback(async () => {
    if (runningRef.current) return;
    const job = queueRef.current.shift();
    if (!job) { runningRef.current = false; return; }

    runningRef.current = true;
    try {
      const form = new FormData();
      // React Native: uri as file-like object
      form.append("photo", { uri: job.uri, name: "photo.jpg", type: "image/jpeg" } as any);
      Object.entries(job.params).forEach(([k, v]) => form.append(k, v));

      await fetch(`${API_BASE}${job.endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${job.token}` },
        body: form,
      });
      setState(s => ({ ...s, pending: Math.max(0, s.pending - 1), done: s.done + 1 }));
    } catch {
      setState(s => ({ ...s, pending: Math.max(0, s.pending - 1), failed: s.failed + 1 }));
    } finally {
      runningRef.current = false;
      // Process next job
      if (queueRef.current.length > 0) runNext();
    }
  }, []);

  const addJobs = useCallback((jobs: PhotoUploadJob[]) => {
    queueRef.current.push(...jobs);
    setState(s => ({ ...s, pending: s.pending + jobs.length }));
    runNext();
  }, [runNext]);

  return (
    <UploadQueueContext.Provider value={{ addJobs, state }}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  return useContext(UploadQueueContext);
}
