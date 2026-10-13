import React, { useCallback, useEffect, useRef, useState } from "react";
import PhonePhotoPickerModal from "@/components/teacher/album/PhonePhotoPickerModal";
import type { PhoneUploadPhoto } from "@/utils/phonePhotoPicker";

/** One cancellable request, shared by every teacher photo upload entry point. */
export function usePhonePhotoPicker() {
  const [visible, setVisible] = useState(false);
  const resolve = useRef<((photos: PhoneUploadPhoto[] | null) => void) | null>(null);
  const open = useCallback(() => new Promise<PhoneUploadPhoto[] | null>(done => {
    if (resolve.current) { done(null); return; }
    resolve.current = done;
    setVisible(true);
  }), []);
  const finish = useCallback((photos: PhoneUploadPhoto[] | null) => {
    const done = resolve.current;
    resolve.current = null;
    setVisible(false);
    done?.(photos);
  }, []);
  useEffect(() => () => {
    resolve.current?.(null);
    resolve.current = null;
  }, []);
  return {
    open,
    modal: visible ? <PhonePhotoPickerModal onCancel={() => finish(null)} onConfirm={finish} /> : null,
  };
}
