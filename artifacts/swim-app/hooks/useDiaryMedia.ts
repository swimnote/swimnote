/**
 * useDiaryMedia — Media Engine v2 클라이언트 훅
 *
 * 일지 작성 중 미디어 상태를 단일 MediaItem 배열로 관리.
 * 기존 selectedAlbumIds / selectedAlbumPhotos / studentAlbumPhotos 분산 상태를 통합.
 *
 * Optimistic UI: 업로드 전 localUri 즉시 표시 → 완료 후 서버 URL 교체
 * React Query: 저장 완료 후 ['diary-media', diaryId] 캐시 즉시 업데이트
 * Draft 복원: AsyncStorage에 initialDiaryKey 기준으로 텍스트+미디어 저장
 */
import { useCallback, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";

export type MediaSource = "camera" | "device" | "album";
export type TargetType = "common" | "student";
export type UploadStatus = "pending" | "uploading" | "uploaded" | "attached" | "error";

export interface MediaItem {
  mediaUuid: string;
  localUri?: string;
  serverPhotoId?: string;
  serverUrl?: string;
  presignedUrl?: string;
  source: MediaSource;
  targetType: TargetType;
  studentId?: string;
  uploadStatus: UploadStatus;
  progress?: number;
  errorMessage?: string;
  isFromAlbum?: boolean;
}

function genUuid(): string {
  return `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useDiaryMedia() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const queryClient = useQueryClient();
  const draftKeyRef = useRef<string | null>(null);

  // ── 조회 헬퍼 ──────────────────────────────────────────────────────────
  const getCommonMedia = useCallback(
    () => items.filter(i => i.targetType === "common"),
    [items]
  );

  const getStudentMedia = useCallback(
    (studentId: string) => items.filter(i => i.targetType === "student" && i.studentId === studentId),
    [items]
  );

  const getAllMedia = useCallback(() => items, [items]);

  // ── 추가 ──────────────────────────────────────────────────────────────
  const addCommonMedia = useCallback((item: Omit<MediaItem, "mediaUuid" | "targetType">) => {
    const newItem: MediaItem = { ...item, mediaUuid: genUuid(), targetType: "common" };
    setItems(prev => [...prev, newItem]);
    return newItem.mediaUuid;
  }, []);

  const addStudentMedia = useCallback((studentId: string, item: Omit<MediaItem, "mediaUuid" | "targetType" | "studentId">) => {
    const newItem: MediaItem = { ...item, mediaUuid: genUuid(), targetType: "student", studentId };
    setItems(prev => [...prev, newItem]);
    return newItem.mediaUuid;
  }, []);

  // 앨범에서 선택된 사진 배열 일괄 추가 (교체 방식: 기존 동일 targetType의 앨범 사진 제거 후 추가)
  const setAlbumMedia = useCallback((
    targetType: TargetType,
    studentId: string | undefined,
    albumPhotos: Array<{ id: string; presignedUrl?: string; serverUrl?: string; localUri?: string }>
  ) => {
    setItems(prev => {
      // 기존 앨범 선택 사진만 제거 (카메라/기기 업로드는 유지)
      const filtered = prev.filter(i => {
        if (i.targetType !== targetType) return true;
        if (targetType === "student" && i.studentId !== studentId) return true;
        return !i.isFromAlbum;
      });
      const newAlbumItems: MediaItem[] = albumPhotos.map(p => ({
        mediaUuid: genUuid(),
        serverPhotoId: p.id,
        presignedUrl: p.presignedUrl,
        serverUrl: p.serverUrl,
        localUri: p.localUri,
        source: "album" as MediaSource,
        targetType,
        studentId,
        uploadStatus: "uploaded" as UploadStatus,
        isFromAlbum: true,
      }));
      return [...filtered, ...newAlbumItems];
    });
  }, []);

  // ── 제거 ──────────────────────────────────────────────────────────────
  const removeMedia = useCallback((mediaUuid: string) => {
    setItems(prev => prev.filter(i => i.mediaUuid !== mediaUuid));
  }, []);

  // ── 상태 업데이트 ──────────────────────────────────────────────────────
  const replaceLocalMediaWithServerMedia = useCallback((
    mediaUuid: string,
    serverPhotoId: string,
    serverUrl?: string,
    presignedUrl?: string
  ) => {
    setItems(prev =>
      prev.map(i =>
        i.mediaUuid === mediaUuid
          ? { ...i, serverPhotoId, serverUrl, presignedUrl, uploadStatus: "uploaded" }
          : i
      )
    );
  }, []);

  const markUploadError = useCallback((mediaUuid: string, errorMessage?: string) => {
    setItems(prev =>
      prev.map(i =>
        i.mediaUuid === mediaUuid
          ? { ...i, uploadStatus: "error", errorMessage }
          : i
      )
    );
  }, []);

  const markUploading = useCallback((mediaUuid: string, progress?: number) => {
    setItems(prev =>
      prev.map(i =>
        i.mediaUuid === mediaUuid
          ? { ...i, uploadStatus: "uploading", progress }
          : i
      )
    );
  }, []);

  const markAttached = useCallback((serverPhotoId: string) => {
    setItems(prev =>
      prev.map(i =>
        i.serverPhotoId === serverPhotoId
          ? { ...i, uploadStatus: "attached" }
          : i
      )
    );
  }, []);

  const retryUpload = useCallback((mediaUuid: string) => {
    setItems(prev =>
      prev.map(i =>
        i.mediaUuid === mediaUuid
          ? { ...i, uploadStatus: "pending", errorMessage: undefined }
          : i
      )
    );
  }, []);

  // ── 파생 값 ──────────────────────────────────────────────────────────
  const getCommonPhotoIds = useCallback(
    () => items
      .filter(i => i.targetType === "common" && i.serverPhotoId && i.uploadStatus !== "error")
      .map(i => i.serverPhotoId!),
    [items]
  );

  const getStudentPhotoIds = useCallback(
    (studentId: string) => items
      .filter(i => i.targetType === "student" && i.studentId === studentId && i.serverPhotoId && i.uploadStatus !== "error")
      .map(i => i.serverPhotoId!),
    [items]
  );

  const hasUploading = useCallback(
    () => items.some(i => i.uploadStatus === "uploading" || i.uploadStatus === "pending"),
    [items]
  );

  const hasError = useCallback(
    () => items.some(i => i.uploadStatus === "error"),
    [items]
  );

  // ── 초기화 / 복원 ──────────────────────────────────────────────────────
  const resetDraft = useCallback(async () => {
    setItems([]);
    if (draftKeyRef.current) {
      await AsyncStorage.removeItem(draftKeyRef.current).catch(() => {});
    }
  }, []);

  const saveDraft = useCallback(async (
    key: string,
    commonContent: string,
    studentNotes: Array<{ studentId: string; content: string }>,
    classGroupId: string,
    lessonDate: string
  ) => {
    draftKeyRef.current = key;
    try {
      const draft = {
        commonContent,
        studentNotes,
        mediaItems: items.map(i => ({
          mediaUuid: i.mediaUuid,
          serverPhotoId: i.serverPhotoId,
          serverUrl: i.serverUrl,
          source: i.source,
          targetType: i.targetType,
          studentId: i.studentId,
          uploadStatus: i.uploadStatus === "uploading" ? "pending" : i.uploadStatus,
          isFromAlbum: i.isFromAlbum,
          // localUri는 앱 재시작 후 유효하지 않을 수 있으므로 serverPhotoId 있으면 생략
          localUri: i.serverPhotoId ? undefined : i.localUri,
        })),
        classGroupId,
        lessonDate,
        updatedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(key, JSON.stringify(draft));
    } catch (e) {
      console.warn("[useDiaryMedia] draft 저장 실패:", e);
    }
  }, [items]);

  const restoreDraft = useCallback(async (key: string): Promise<{
    commonContent: string;
    studentNotes: Array<{ studentId: string; content: string }>;
    classGroupId?: string;
    lessonDate?: string;
  } | null> => {
    draftKeyRef.current = key;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const draft = JSON.parse(raw);

      // 미디어 복원 (localUri 유효성은 소비처에서 확인)
      if (Array.isArray(draft.mediaItems)) {
        setItems(draft.mediaItems.map((m: any) => ({
          mediaUuid: m.mediaUuid || genUuid(),
          serverPhotoId: m.serverPhotoId,
          serverUrl: m.serverUrl,
          localUri: m.localUri,
          source: m.source || "album",
          targetType: m.targetType || "common",
          studentId: m.studentId,
          uploadStatus: m.serverPhotoId ? "uploaded" : "pending",
          isFromAlbum: m.isFromAlbum,
        })));
      }

      return {
        commonContent: draft.commonContent || "",
        studentNotes: draft.studentNotes || [],
        classGroupId: draft.classGroupId,
        lessonDate: draft.lessonDate,
      };
    } catch (e) {
      console.warn("[useDiaryMedia] draft 복원 실패:", e);
      return null;
    }
  }, []);

  // ── React Query 캐시 즉시 업데이트 (attach 완료 후) ────────────────────
  const invalidateDiaryMediaCache = useCallback((diaryId: string) => {
    queryClient.invalidateQueries({ queryKey: ["diary-media", diaryId] });
  }, [queryClient]);

  return {
    items,
    // 조회
    getCommonMedia,
    getStudentMedia,
    getAllMedia,
    // 추가
    addCommonMedia,
    addStudentMedia,
    setAlbumMedia,
    // 제거
    removeMedia,
    // 상태 업데이트
    replaceLocalMediaWithServerMedia,
    markUploadError,
    markUploading,
    markAttached,
    retryUpload,
    // 파생 값
    getCommonPhotoIds,
    getStudentPhotoIds,
    hasUploading,
    hasError,
    // draft
    resetDraft,
    saveDraft,
    restoreDraft,
    // 캐시
    invalidateDiaryMediaCache,
  };
}

export default useDiaryMedia;
