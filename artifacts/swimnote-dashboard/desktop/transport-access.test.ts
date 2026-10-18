import {it,expect} from "vitest";
import {isOfficeApiRequest,officePage} from "./office-access.cjs";
import {readFileSync} from "node:fs";
it("transport: registers the same normal navigation page and only explicit preparation routes",()=>{
  expect(officePage("/admin/office/transport")).toBeTruthy();
  for(const [path,method] of [
    ["/office/operations/transport","GET"],
    ["/office/operations/transport/snapshots/snapshot","GET"],
    ["/office/operations/transport/plans/plan/preview","GET"],
    ["/office/operations/transport/records","POST"],
    ["/office/operations/transport/records/record","PATCH"],
    ["/office/operations/transport/plans/plan/approve","POST"],
  ])expect(isOfficeApiRequest(path,method)).toBe(true);
  for(const [path,method] of [
    ["/office/operations/transport/records/record","DELETE"],
    ["/office/operations/transport/plans/plan/publish","POST"],
    ["/office/operations/transport/runs/run/resolve","POST"],
    ["/office/operations/transport/anything","GET"],
  ])expect(isOfficeApiRequest(path,method)).toBe(false);
});
it("transport: connects the actual PC route as well as the shared navigation entry",()=>{
  const source=readFileSync(new URL("../src/desktop/OfficePages.tsx",import.meta.url),"utf8");
  expect(source).toContain('path="/admin/office/transport"><OfficeTransportPanel');
});
