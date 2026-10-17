/** All three release gates (renderer, Electron main, server) must be explicitly approved. */
export const OFFICE_STAGE3_ACTIVE = false;
export function isOfficeStage3Request(path: string, method: string, enabled: boolean): boolean {
  return enabled && (
    method === "POST" && (path === "/office/command" || path === "/office/interpret") ||
    method === "GET" && /^\/office\/commands\/[A-Za-z0-9_-]{1,160}$/.test(path)
  );
}
