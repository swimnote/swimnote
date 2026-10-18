import {it,expect} from "vitest";
import {ACTIVITY_KINDS,ACTIVITY_REPORT_SQL as sql} from "../office-activity-report.js";
it("reads existing canonical sources with pool boundaries and explicit period bases in one statement",()=>{
  expect(ACTIVITY_KINDS).toEqual(["members","registrations","renewals","attendance","makeups"]);
  for(const source of ["students s","office_operation_records r","attendance a","makeup_sessions m"])expect(sql).toContain(`FROM ${source}`);
  for(const field of ["s.swimming_pool_id=$1","r.pool_id=$1","a.swimming_pool_id=$1","m.swimming_pool_id=$1"])expect(sql).toContain(field);
  expect(sql).toContain("r.data->>'startDate'>=$2");expect(sql).toContain("a.date>=$2");expect(sql).toContain("m.absence_date>=$2");
  expect(sql).toContain("previousContractId");expect(sql).toContain("kind=$5");
  expect(sql).toContain("LIMIT $7 OFFSET $6");expect(sql).toContain("SELECT COUNT(*)::int FROM filtered WHERE kind=$5");
  expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE)\b/);
});
