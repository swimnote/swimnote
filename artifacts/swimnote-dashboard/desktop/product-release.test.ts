import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { isAllowedAuthRequest } from "./security.cts";
import { renderInstaller } from "./installer-config.mjs";
const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve("vite"))("esbuild");
function policy(enabled: boolean) {
  const module = { exports: {} as any };
  const code = transformSync(readFileSync(new URL("../src/lib/office-stage3-policy.ts", import.meta.url), "utf8"),
    { loader: "ts", format: "cjs", define: { __OFFICE_STAGE3_ACTIVE__: String(enabled) } }).code;
  vm.runInNewContext(code, { module, exports: module.exports });
  return module.exports;
}
it("only an explicitly opted-in product build connects the existing Stage 3 transport", () => {
  expect(policy(false).OFFICE_STAGE3_ACTIVE).toBe(false);
  const release = policy(true);
  expect(release.OFFICE_STAGE3_ACTIVE).toBe(true);
  for (const path of ["/office/requests", "/office/command", "/office/interpret"]) {
    expect(release.isOfficeStage3Request(path, "POST", true)).toBe(true);
    expect(isAllowedAuthRequest("https://swimnote-api.onrender.com/api" + path, "POST", true)).toBe(true);
  }
});
it("product opt-in does not permit arbitrary writes, local backends or foreign origins", () => {
  for (const url of ["http://127.0.0.1:20411/api/office/command", "https://evil.example/api/office/command",
    "https://swimnote-api.onrender.com/api/students/member", "https://swimnote-api.onrender.com/api/office/command?bypass=1"])
    expect(isAllowedAuthRequest(url, "POST", true)).toBe(false);
  for (const method of ["PUT", "PATCH", "DELETE"])
    expect(isAllowedAuthRequest("https://swimnote-api.onrender.com/api/office/command", method, true)).toBe(false);
});
it("Electron product main receives the same explicit build-time opt-in", () => {
  const code = transformSync(readFileSync(new URL("./main.cts", import.meta.url), "utf8"),
    { loader: "ts", format: "cjs", define: { __OFFICE_STAGE3_ACTIVE__: "true" } }).code;
  expect(code).not.toContain("__OFFICE_STAGE3_ACTIVE__");
  const flag = code.match(/isAllowedAuthRequest\)\(\s*details\.url,\s*details\.method,\s*([^)]+)\)/)?.[1];
  expect(flag).toBeDefined();
  expect(vm.runInNewContext(flag!)).toBe(true);
  expect(code).not.toContain("startIsolation");
  expect(code).not.toContain("spawn(");
});
it("reuses the existing product installer identity, ownership checks and preserved userData policy", () => {
  const script = renderInstaller({ payloadDir: "/tmp/payload", outputFile: "/tmp/office.exe",
    packageId: "PRODUCT-" + "a".repeat(12) + "-" + "b".repeat(12), stage: "PRODUCT", files: ["resources/app.asar"] });
  expect(script).toContain("OFFICE V1");
  expect(script).toContain('InstallDir "$LOCALAPPDATA\\Programs\\SWIMNOTE OFFICE"');
  expect(script).toContain("RequestExecutionLevel user");
  expect(script).not.toContain("taskkill");
  expect(script).not.toContain("PostgreSQL");
});
