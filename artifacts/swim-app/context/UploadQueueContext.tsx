import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { deleteTempFileAfterUpload } from "@/utils/mediaCleanupV2";
import { API_BASE } from "@/context/auth/SessionContext";

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

const API_BASE_URL = API_BASE;
const CONCURRENCY = 3;

async function uploadOnce(job: PhotoUploadJob): Promise<boolean> {
  try {
    const form = new FormData();
    // 파일 첨부 (React Native FormData 방식)
    const fieldName = job.endpoint.includes("batch") ? "photos" : "photos";
    form.append(fieldName, {
      uri: job.uri,
      name: "photo.jpg",
      type: "image/jpeg",
    } as any);
    // 추가 파라미터
    for (const [key, val] of Object.entries(job.params)) {
      if (val) form.append(key, val);
    }
    const res = await fetch(`${API_BASE_URL}${job.endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${job.token}` },
      body: form,
    });
    return res.status >= 200 && res.status < 300;
  } catch (e) {
    console.warn("[UploadQueue] uploadOnce 실패:", e);
    return false;
  }
}

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [total,    setTotal]    = useState(0);
  const [done,     setDone]     = useState(0);
  const [failed,   setFailed]   = useState(0);
  const [isActive, setIsActive] = useState(false);

  const queueRef      = useRef<(PhotoUploadJob & { id: string })[]>([]);
  const activeCountRef = useRef(0);

  async function uploadOne(job: PhotoUploadJob & { id: string }) {
    // 최대 2회 시도
    let ok = await uploadOnce(job);
    if (!ok) {
      await new Promise(r => setTimeout(r, 2000));
      ok = await uploadOnce(job);
    }
    if (ok) {
      setDone(d => d + 1);
      // 업로드 성공 후 cacheDirectory temp 파일 삭제 (ImageManipulator/ImagePicker temp copy)
      // MediaLibrary 원본(ph://, assets-library://)은 건드리지 않음
      deleteTempFileAfterUpload(job.uri).catch(() => {});
    } else {
      setFailed(f => f + 1);
      // 최종 실패 후 temp 삭제 — 2회 재시도 모두 소진된 이후이므로 더 이상 URI 불필요
      deleteTempFileAfterUpload(job.uri).catch(() => {});
    }
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
