import {describe,it,expect} from "vitest";
import {isOfficeApiRequest,officeRoleRequest,officePageAllowed} from "./office-access.cjs";
const paths:[string,string][]=[
  ["/office/operations/finance/snapshot?from=2026-10-01&to=2026-10-18&studentId=student_text_123","GET"],
  ["/office/operations/finance/preview","POST"],["/office/operations/finance/execute","POST"],
  ["/office/operations/finance/batch/preview","POST"],["/office/operations/finance/batch/execute","POST"],
  ["/office/operations/nfc/resolve","POST"],["/office/operations/nfc/scan","POST"],
  ["/office/operations/applications","GET"],["/office/operations/applications/invite","POST"],
  ["/office/operations/applications/application_text_123/confirm","POST"],
  ["/office/operations/applications/application_text_123/document","GET"],
  ["/office/operations/imports/import_text_123/finance-preview","POST"],
  ["/office/operations/imports/import_text_123/finance-apply","POST"],
  ["/office/operations/workspace/catalog","GET"],["/office/operations/workspace/interpret","POST"],
  ["/office/operations/templates","GET"],["/office/operations/support","POST"],["/office/operations/policies","POST"],
  ["/admin/growth-reports/monthly-list?history=published&year=2026&month=10&limit=50&offset=0","GET"],
];
describe("OFFICE operational native permissions",()=>{
  it.each(paths)("allows exact admin operation %s %s",(path,method)=>{
    expect(isOfficeApiRequest(path,method)).toBe(true);
    expect(officeRoleRequest(path,method,"pool_admin")).toBe(true);
    expect(officeRoleRequest(path,method,"parent")).toBe(false);
    expect(officeRoleRequest(path,method,"teacher")).toBe(false);
  });
  it("excludes public tablet capability requests, arbitrary ledger writes and execution query overrides",()=>{
    for(const [path,method] of [["/office-tablet/submit","POST"],["/office/operations/ledger","POST"],
      ["/office/operations/finance/execute?poolId=other","POST"],["/office/operations/nfc/scan?confirmed=true","POST"]])
      expect(isOfficeApiRequest(path!,method!)).toBe(false);
  });
  it.each(["finance","applications","support","policies"])("keeps admin menu %s out of teacher surface",key=>{
    expect(officePageAllowed(`/admin/office/${key}`,"pool_admin")).toBe(true);
    expect(officePageAllowed(`/admin/office/${key}`,"teacher")).toBe(false);
  });
});
