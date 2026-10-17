/** Product packaging opts in; ordinary web/dev builds remain unchanged. Server gates still apply. */
declare const __OFFICE_STAGE3_ACTIVE__: boolean;
export const OFFICE_STAGE3_ACTIVE = typeof __OFFICE_STAGE3_ACTIVE__ === "boolean" && __OFFICE_STAGE3_ACTIVE__;
export function isOfficeStage3Request(path: string, method: string, enabled: boolean): boolean {
  return method === "GET" && /^\/office\/commands\/[A-Za-z0-9_-]{1,160}$/.test(path) ||
    enabled && method === "POST" && ["/office/requests", "/office/command", "/office/interpret"].includes(path);
}
