// @vitest-environment jsdom
import {it,expect} from "vitest";
import {OfficeOperationsPanel} from "../src/desktop/OfficeOperationsPanel";
import {OfficeImportsPanel} from "../src/desktop/OfficeImportsPanel";
it("loads both administrator panels without circular module initialization",()=>{
  expect(typeof OfficeOperationsPanel).toBe("function");
  expect(typeof OfficeImportsPanel).toBe("function");
});
