import path from "node:path";

export const ENTRY_URL = "app://office/admin/login";
export const BOOTSTRAP_CHANNEL = "office:bootstrap-info";
// Canonical authentication, pool SSE and the F05 read-only runtime. No HTTP proxy.
export const AUTH_API_ORIGIN = "https://swimnote-api.onrender.com";
const AUTH_ROUTES: Record<string, readonly string[]> = {
  "/api/auth/login": ["POST", "OPTIONS"],
  "/api/auth/web-pin/verify": ["POST", "OPTIONS"],
  "/api/auth/totp/verify-login": ["POST", "OPTIONS"],
  "/api/auth/me": ["GET", "OPTIONS"],
  "/api/pools/my-pools": ["GET", "OPTIONS"],
  "/api/pools/x-mode": ["GET", "OPTIONS"],
  "/api/admin/events/stream": ["GET", "OPTIONS"],
};

export function isAllowedAuthRequest(raw: string, method: string, stage3Enabled = false): boolean {
  try {
    const url = new URL(raw);
    if (url.origin !== AUTH_API_ORIGIN || url.username || url.password || url.hash) return false;
    if (!url.search && AUTH_ROUTES[url.pathname]?.includes(method)) return true;
    if (stage3Enabled && !url.search && (
      (method === "POST" || method === "OPTIONS") && ["/api/office/command", "/api/office/interpret"].includes(url.pathname) ||
      (method === "GET" || method === "OPTIONS") && /^\/api\/office\/commands\/[A-Za-z0-9_-]{1,160}$/.test(url.pathname)
    )) return true;
    if (method !== "GET" && method !== "OPTIONS") return false;
    if (url.pathname === "/api/students") return url.search === "?pool_all=true";
    return !url.search && (
      url.pathname === "/api/admin/dashboard-stats" || url.pathname === "/api/class-groups" ||
      /^\/api\/admin\/growth-reports\/students\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname) ||
      // Existing students.ts/student-create-service.ts IDs are text, not UUID-only.
      /^\/api\/admin\/growth-reports\/students\/student_[0-9]{13}_[a-z0-9]{1,9}$/.test(url.pathname)
    );
  } catch { return false; }
}
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${AUTH_API_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The raw path is checked before URL normalization can erase traversal. */
export function resolveRendererPath(rawUrl: string, root: string): string | null {
  const match = /^app:\/\/office(\/[^?#]*)?(?:[?#].*)?$/.exec(rawUrl);
  if (!match) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(match[1] || "/");
  } catch {
    return null;
  }
  if (/[%\\\u0000-\u001f\u007f<>:"|?*]/.test(pathname)) return null;
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return null;
  const segments = pathname.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  const relative = pathname.slice("/admin".length).replace(/^\/+/, "");
  const file = path.extname(relative) ? relative : "desktop.html";
  const destination = path.resolve(root, file);
  return isInsideDirectory(root, destination) ? destination : null;
}

export function isInsideDirectory(root: string, destination: string): boolean {
  const relative = path.relative(root, destination);
  return relative !== "" && !relative.startsWith(".." + path.sep) &&
    relative !== ".." && !path.isAbsolute(relative);
}

export function validateDevelopmentURL(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !url.port || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith("/admin/")) {
    throw new Error("OFFICE_DEV_URL must be an explicit loopback /admin/ URL");
  }
  return url.href;
}

export function isTrustedRendererURL(raw: string, developmentURL?: string): boolean {
  if (resolveRendererPath(raw, path.resolve("renderer")) !== null) return true;
  if (!developmentURL) return false;
  try {
    const expected = new URL(developmentURL);
    const actual = new URL(raw);
    return actual.origin === expected.origin && !actual.username && !actual.password &&
      (actual.pathname === "/admin" || actual.pathname.startsWith("/admin/"));
  } catch {
    return false;
  }
}

export function isValidBootstrapPayload(args: unknown[]): boolean {
  return args.length === 1 && args[0] === null;
}

export type WindowBounds = { x: number; y: number; width: number; height: number };
export function clampWindowBounds(
  saved: Partial<WindowBounds> | undefined,
  work: WindowBounds,
): WindowBounds {
  const number = (n: unknown, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  const width = Math.min(work.width, Math.max(Math.min(960, work.width), number(saved?.width, 1280)));
  const height = Math.min(work.height, Math.max(Math.min(640, work.height), number(saved?.height, 800)));
  const x = Math.max(work.x, Math.min(work.x + work.width - width, number(saved?.x, work.x + (work.width - width) / 2)));
  const y = Math.max(work.y, Math.min(work.y + work.height - height, number(saved?.y, work.y + (work.height - height) / 2)));
  return { x, y, width, height };
}
