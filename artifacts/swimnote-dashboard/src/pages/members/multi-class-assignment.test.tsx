// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditModal } from "./MembersPage";
const { patch } = vi.hoisted(() => ({ patch: vi.fn(async () => ({})) }));
vi.mock("@/lib/api-client", () => ({ api: { patch } }));
afterEach(() => { cleanup(); patch.mockClear(); });
function mount() {
  const saved = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}>
    <EditModal student={{id:"A",name:"fixture-A",status:"active",class_group_id:"TUE",assigned_class_ids:["TUE","THU"]}}
      classGroups={[{id:"TUE",name:"Tuesday 16"},{id:"THU",name:"Thursday 16"}]}
      onClose={()=>{}} onSaved={saved} />
  </QueryClientProvider>);
  return saved;
}
describe("PC multi-class editing", () => {
  it("initializes both class checkboxes", () => {
    mount();
    expect((screen.getByRole("checkbox",{name:"Tuesday 16"}) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox",{name:"Thursday 16"}) as HTMLInputElement).checked).toBe(true);
  });
  it("editing only name never calls assignment API", async () => {
    const saved = mount();
    fireEvent.change(screen.getAllByRole("textbox")[0],{target:{value:"fixture-renamed"}});
    fireEvent.click(screen.getByRole("button",{name:/저장/}));
    await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe("/admin/students/A/info");
  });
  it("intentional removal submits the complete remaining array", async () => {
    const saved=mount();
    fireEvent.click(screen.getByRole("checkbox",{name:"Thursday 16"}));
    fireEvent.click(screen.getByRole("button",{name:/저장/}));
    await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(patch).toHaveBeenCalledWith("/students/A/assign",{assigned_class_ids:["TUE"]});
  });
  it("assignment failure is visible and does not announce success", async () => {
    const saved=mount();
    patch.mockImplementationOnce(async()=>({})).mockImplementationOnce(async()=>{throw new Error("fixture assignment failed");});
    fireEvent.click(screen.getByRole("checkbox",{name:"Thursday 16"}));
    fireEvent.click(screen.getByRole("button",{name:/저장/}));
    await screen.findByText("fixture assignment failed");
    expect(saved).not.toHaveBeenCalled();
  });
});
