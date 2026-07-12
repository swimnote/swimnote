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
const CONCURRENCY = 3;

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [total,    setTotal]    = useState(0);
  const [done,     setDone]     = useState(0);
  const [failed,   setFailed]   = useState(0);
  const [isActive, setIsActive] = useState(false);

  const queueRef      = useRef<(PhotoUploadJob & { id: string })[]>([]);
  const activeCountRef = useRef(0);

  async function uploadOne(job: PhotoUploadJob & { id: string }) {
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
          setDone(d => d + 1);
          return;
        }
      } catch {
        // retry
      }
    }
    setFailed(f => f + 1);
  }

  async function runWorker() {
    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (!job) break;
      await uploadOne(job);
    }
    activeCountRef.current -= 1;
    if (activeCountRef.current === 0) setIsActive(false);
  }

  const addJobs = useCallback((jobs: PhotoUploadJob[]) => {
    if (!jobs.length) return;
    const tagged = jobs.map((j, i) => ({ ...j, id: `${Date.now()}_${i}` }));
    queueRef.current.push(...tagged);
    setTotal(t => t + jobs.length);
    setIsActive(true);

    const toStart = Math.max(0, CONCURRENCY - activeCountRef.current);
    const actualStart = Math.min(toStart, tagged.length);
    for (let i = 0; i < actualStart; i++) {
      activeCountRef.current += 1;
      runWorker();
    }
  }, []);

  const dismiss = useCallback(() => {
    if (activeCountRef.current > 0) return;
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
