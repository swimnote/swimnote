import {it,expect} from "vitest";
import {isOfficeApiRequest} from "./office-access.cjs";
it("exposes the administrator report as an exact read, not a mutation or arbitrary report path",()=>{
  expect(isOfficeApiRequest("/office/operations/activity-report?from=2026-10-01&to=2026-10-18","GET")).toBe(true);
  for(const method of ["POST","PUT","PATCH","DELETE"])expect(isOfficeApiRequest("/office/operations/activity-report",method)).toBe(false);
  expect(isOfficeApiRequest("/office/operations/activity-report/private","GET")).toBe(false);
});
