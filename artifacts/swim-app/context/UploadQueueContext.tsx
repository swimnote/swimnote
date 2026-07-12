import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import * as FileSystem from "expo-file-system";

export interface PhotoUploadJob {
  uri: string;
  endpoint: string;
  params: Record<string, string>;
  token: string;
}

interface UploadQueueCtxType {
  total: number;
  done: number;
  failed: number;
  isActive: boolean;
  addJobs: (jobs: PhotoUploadJob[]) => void;
  dismiss: () => void;
}

const UploadQueueCtx = createContext<UploadQueueCtxType>({
  total: 0, done: 0, failed: 0, isActive: false,
  addJobs: () => {}, dismiss: () => {},
});

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "";

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [total,    setTotal]    = useState(0);
  const [done,     setDone]     = useState(0);
  const [failed,   setFailed]   = useState(0);
  const [isActive, setIsActive] = useState(false);

  const queueRef   = useRef<(PhotoUploadJob & { id: string })[]>([]);
  const workingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;

    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      let success = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
          const result = await FileSystem.uploadAsync(
            `${API_BASE_URL}${job.endpoint}`,
            job.uri,
            {
              httpMethod: "POST",
              uploadType: 1 as any,
              fieldName: "photos",
              headers: { Authorization: `Bearer ${job.token}` },
              parameters: job.params,
            }
          );
          if (result.status >= 200 && result.status < 300) {
            success = true;
            break;
          }
        } catch {
          // 재시도
        }
      }
      if (success) setDone(d => d + 1);
      else setFailed(f => f + 1);
    }

    workingRef.current = false;
    setIsActive(false);
  }, []);

  const addJobs = useCallback((jobs: PhotoUploadJob[]) => {
    if (!jobs.length) return;
    const tagged = jobs.map((j, i) => ({ ...j, id: `${Date.now()}_${i}` }));
    queueRef.current.push(...tagged);
    setTotal(t => t + jobs.length);
    setIsActive(true);
    processQueue();
  }, [processQueue]);

  const dismiss = useCallback(() => {
    if (workingRef.current) return;
    setTotal(0);
    setDone(0);
    setFailed(0);
    setIsActive(false);
    queueRef.current = [];
  }, []);

  return (
    <UploadQueueCtx.Provider value={{ total, done, failed, isActive, addJobs, dismiss }}>
      {children}
    </UploadQueueCtx.Provider>
  );
}

export const useUploadQueue = () => useContext(UploadQueueCtx);
