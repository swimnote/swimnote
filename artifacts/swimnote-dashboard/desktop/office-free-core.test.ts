import {describe,it,expect} from "vitest";
import {isOfficeApiRequest,officePageAllowed,officeRoleRequest} from "./office-access.cts";
describe("free OFFICE admin core Native boundary",()=>{
  it.each(["contacts","courses","sessions","imports","marketing","cards"])("admits admin page %s but not teacher",page=>{
    expect(officePageAllowed(`/admin/office/${page}`,"pool_admin")).toBe(true);
    expect(officePageAllowed(`/admin/office/${page}`,"teacher")).toBe(false);
  });
  it("allows correct admin review and discard method only",()=>{
    expect(isOfficeApiRequest("/admin/growth-reports/r1/mark-reviewed","POST")).toBe(true);
    expect(isOfficeApiRequest("/admin/growth-reports/r1/discard","PUT")).toBe(true);
  });
  it("allows status-filtered real pagination",()=>{
    expect(isOfficeApiRequest("/admin/growth-reports/monthly-list?product_status=APPROVED,READY_TO_SEND&offset=50&limit=50","GET")).toBe(true);
  });
  it("exposes import receipt lookup without enabling arbitrary URLs",()=>{
    expect(isOfficeApiRequest("/office/operations/receipts/abc-123","GET")).toBe(true);
    expect(isOfficeApiRequest("/office/operations/../../auth/me","GET")).toBe(false);
    expect(isOfficeApiRequest("//external.invalid/office/operations/cards","GET")).toBe(false);
    expect(officeRoleRequest("/office/operations/products","POST","teacher")).toBe(false);
  });
});
