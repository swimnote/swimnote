import { expect, it } from "vitest";
import { isAllowedAuthRequest } from "./security.cts";
import { OFFICE_STAGE3_ACTIVE, isOfficeStage3Request } from "../src/lib/office-stage3-policy";
const origin = "https://swimnote-api.onrender.com";
it("production renderer and native defaults deny all new writes", () => {
  expect(OFFICE_STAGE3_ACTIVE).toBe(false);
  for (const path of ["/office/command", "/office/interpret"]) {
    expect(isOfficeStage3Request(path, "POST", OFFICE_STAGE3_ACTIVE)).toBe(false);
    expect(isAllowedAuthRequest(origin + "/api" + path, "POST")).toBe(false);
  }
});
it("approved opt-in allowlist is exact method/path, never a blanket POST grant", () => {
  for (const path of ["/office/command", "/office/interpret"])
    for (const method of ["POST", "OPTIONS"])
      expect(isAllowedAuthRequest(origin + "/api" + path, method, true)).toBe(true);
  expect(isAllowedAuthRequest(origin + "/api/office/commands/request_1", "GET", true)).toBe(true);
  for (const [path, method] of [["/office/command?pool=other", "POST"], ["/office/command/", "POST"], ["/office/command", "PATCH"],
    ["/office/commands/request_1", "POST"], ["/anything", "POST"], ["/office/interpret/extra", "POST"]]) {
    expect(isAllowedAuthRequest(origin + "/api" + path, method, true)).toBe(false);
    expect(isOfficeStage3Request(path, method, true)).toBe(false);
  }
  expect(isAllowedAuthRequest("https://example.invalid/api/office/command", "POST", true)).toBe(false);
  // Existing product Action editing is independent of the new Stage3 write gate.
  expect(isAllowedAuthRequest(origin + "/api/students/ui_one","PATCH",true)).toBe(true);
  expect(isOfficeStage3Request("/students/ui_one","PATCH",true)).toBe(false);
  expect(isAllowedAuthRequest(origin + "/api/students/ui_one/anything","PATCH",true)).toBe(false);
});
it("read-only status remains allowed with all new-execution switches OFF", () => {
  const path = "/office/commands/os1_00000000-0000-0000-0000-000000000001";
  expect(isOfficeStage3Request(path, "GET", false)).toBe(true);
  expect(isAllowedAuthRequest(origin + "/api" + path, "GET", false)).toBe(true);
  expect(isAllowedAuthRequest(origin + "/api" + path, "POST", false)).toBe(false);
  expect(isAllowedAuthRequest(origin + "/api" + path + "?pool=other", "GET", false)).toBe(false);
  expect(isAllowedAuthRequest(origin + "/api/office/requests", "POST", false)).toBe(false);
  expect(isAllowedAuthRequest(origin + "/api/office/requests", "POST", true)).toBe(true);
});
