import type { OfficeDesktopBridge } from "../../desktop/contracts";

declare global {
  interface Window {
    readonly officeDesktop?: OfficeDesktopBridge;
  }
}
