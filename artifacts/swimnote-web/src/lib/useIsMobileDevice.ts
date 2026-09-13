/**
 * useIsMobileDevice
 *
 * Returns true when the current device is a phone or tablet.
 * Returns false for desktop/laptop — including Windows touchscreen laptops.
 *
 * Logic (in order):
 *  1. iPadOS 13+ disguises as "MacIntel" but has multiple touch points — catch it.
 *  2. Standard mobile/tablet User-Agent strings.
 *  3. Coarse-only pointer (no fine pointer) + narrow viewport — catches
 *     unlisted tablet browsers without blocking Windows touch laptops
 *     (which always report a fine pointer alongside the coarse one).
 *
 * This is a UX environment guard, NOT a security control.
 * Server-side auth remains mandatory.
 */
export function isMobileOrTabletDevice(): boolean {
  if (typeof window === "undefined") return false;

  // ── 1. iPadOS 13+ ───────────────────────────────────────────────────────────
  // iPadOS pretends to be a Mac (platform = "MacIntel") but exposes > 1 touch point.
  const isIPadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (isIPadOS) return true;

  // ── 2. Standard mobile/tablet UA ────────────────────────────────────────────
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua))
    return true;

  // ── 3. Coarse-only pointer + narrow viewport ─────────────────────────────────
  // Windows touch laptops have BOTH fine (mouse) and coarse (touch) pointers,
  // so `hasFinePointer` is true on them → they pass through.
  const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const hasFinePointer   = window.matchMedia("(pointer: fine)").matches;
  if (hasCoarsePointer && !hasFinePointer && window.innerWidth < 1100) return true;

  return false;
}
