/**
 * useWriteGuard — 읽기전용/용량초과 시 쓰기 작업 차단 훅
 *
 * 사용법:
 *   const { guard, guardUpload, isReadOnly, isUploadBlocked } = useWriteGuard();
 *   // 버튼 onPress에서:
 *   guard(() => openAddMemberModal());
 *   guardUpload(() => pickImage());
 */

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

export type WriteGuardModal = "readonly" | "upload_blocked" | "member_limit" | null;

export function useWriteGuard() {
  const { pool } = useAuth();
  const [modal, setModal] = useState<WriteGuardModal>(null);

  const isReadOnly = !!(pool?.is_readonly);
  const isUploadBlocked = !!(pool?.upload_blocked);

  function guard(fn: () => void): void {
    if (isReadOnly) { setModal("readonly"); return; }
    fn();
  }

  function guardUpload(fn: () => void): void {
    if (isReadOnly) { setModal("readonly"); return; }
    if (isUploadBlocked) { setModal("upload_blocked"); return; }
    fn();
  }

  function closeModal() { setModal(null); }

  return { guard, guardUpload, modal, closeModal, isReadOnly, isUploadBlocked };
}
