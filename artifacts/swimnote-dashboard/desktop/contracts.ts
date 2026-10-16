export const BOOTSTRAP_CHANNEL = "office:bootstrap-info";

export type BootstrapInfo = Readonly<{
  version: string;
  platform: string;
  packaged: boolean;
  stage: "F02";
}>;

export type OfficeDesktopBridge = Readonly<{
  getBootstrapInfo: () => Promise<BootstrapInfo>;
}>;
