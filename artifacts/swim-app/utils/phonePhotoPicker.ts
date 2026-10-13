export const PHONE_PHOTO_LIMIT = 100;
export const PHONE_PHOTO_PAGE_SIZE = 60;
// HOLD: Android's released binary removes photo-library read permissions.
// Do not enable or publish this replacement until native compatibility is approved.
export const USE_CUSTOM_PHONE_PHOTO_PICKER = false;

export interface PhoneLibraryAsset {
  id: string;
  uri: string;
  filename: string;
  width: number;
  height: number;
  creationTime: number;
}

export interface PhoneUploadPhoto {
  uri: string;
  fileName: string;
  mimeType?: string;
  width: number;
  height: number;
}

export interface PhonePhotoSelection {
  ids: Set<string>;
  sequence: Map<string, number>;
  nextSequence: number;
}

export function emptyPhoneSelection(): PhonePhotoSelection {
  return { ids: new Set(), sequence: new Map(), nextSequence: 0 };
}

/** Pure transition: safe when React replays a state updater. */
export function changePhoneSelection(previous: PhonePhotoSelection, ids: Set<string>): PhonePhotoSelection {
  const next = new Set([...ids].slice(0, PHONE_PHOTO_LIMIT));
  const sequence = new Map(previous.sequence);
  let nextSequence = previous.nextSequence;
  for (const id of previous.ids) if (!next.has(id)) sequence.delete(id);
  for (const id of next) if (!previous.ids.has(id)) sequence.set(id, nextSequence++);
  return { ids: next, sequence, nextSequence };
}

export function orderedPhonePhotoIds(selection: PhonePhotoSelection): string[] {
  return [...selection.ids].sort((a, b) => selection.sequence.get(a)! - selection.sequence.get(b)!);
}

export function selectedPhonePhotos(selection: PhonePhotoSelection, assets: PhoneLibraryAsset[]) {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  return orderedPhonePhotoIds(selection).map(id => {
    const asset = byId.get(id);
    if (!asset) throw new Error("선택한 사진을 다시 확인해주세요.");
    return asset;
  });
}

export function appendPhonePhotoPage(previous: PhoneLibraryAsset[], page: PhoneLibraryAsset[]) {
  const seen = new Set(previous.map(asset => asset.id));
  return [...previous, ...page.filter(asset => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  })];
}

export const phonePhotoPageQuery = (after?: string) => ({
  first: PHONE_PHOTO_PAGE_SIZE,
  after,
  mediaType: "photo" as const,
  sortBy: [["creationTime", false] as [string, boolean]],
});

export function canReadPhonePhotos(permission: { granted: boolean; accessPrivileges?: string }) {
  return permission.granted || permission.accessPrivileges === "limited";
}

/** Resolve originals only on Done; concurrent downloads never determine array order. */
export async function resolvePhonePhotos(
  assets: PhoneLibraryAsset[],
  readInfo: (asset: PhoneLibraryAsset) => Promise<{ localUri?: string; filename: string; width: number; height: number }>,
  isCurrent: () => boolean,
): Promise<PhoneUploadPhoto[]> {
  if (assets.length > PHONE_PHOTO_LIMIT) throw new Error("사진은 최대 100장까지 선택할 수 있습니다.");
  const result = new Array<PhoneUploadPhoto>(assets.length);
  let cursor = 0;
  async function worker() {
    while (cursor < assets.length) {
      if (!isCurrent()) throw new Error("선택이 취소되었습니다.");
      const index = cursor++;
      const asset = assets[index];
      const info = await readInfo(asset);
      if (!isCurrent()) throw new Error("선택이 취소되었습니다.");
      const uri = info.localUri || asset.uri;
      if (!/^(file|content):\/\//i.test(uri)) {
        throw new Error("사진 원본을 가져오지 못했습니다. iCloud와 사진 접근 권한을 확인해주세요.");
      }
      const filename = info.filename || asset.filename;
      const extension = filename.split(".").pop()?.toLowerCase();
      const mimeType = extension === "heic" || extension === "heif" ? "image/heic"
        : extension === "png" ? "image/png" : extension === "webp" ? "image/webp"
        : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : undefined;
      result[index] = { uri, fileName: filename, mimeType, width: info.width, height: info.height };
    }
  }
  // allSettled prevents a failed worker from leaving another download racing a retry.
  const completed = await Promise.allSettled(Array.from({ length: Math.min(2, assets.length) }, worker));
  const failed = completed.find(item => item.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return result;
}
