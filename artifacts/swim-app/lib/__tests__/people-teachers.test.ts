import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../app/(admin)/people-teachers.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
type Element = { type: any; props: Record<string, any> };
function harness(apiRequest: any, themeColor: string) {
  const values: any[] = [];
  let cursor = 0, effect: (() => any) | undefined;
  const react = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next:any) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useCallback: (callback:any) => callback,
    useEffect: (callback:any) => { effect = callback; },
    createElement: (type:any, props:any, ...children:any[]): Element => ({
      type, props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
  };
  const native = Object.fromEntries([
    "ActivityIndicator","FlatList","Pressable","RefreshControl","Text","TextInput","View",
  ].map(key => [key, key]));
  const requireMock = (name: string) => {
    if (name === "react") return react;
    if (name === "react-native") return { ...native, Platform: { OS: "ios" }, Alert: { alert: vi.fn() }, StyleSheet: { create: (v:any) => v } };
    if (name === "expo-router") return { router: { push: vi.fn() } };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0 }) };
    if (name === "@/constants/colors") return { light: {} };
    if (name === "@/context/AuthContext") return { apiRequest, useAuth: () => ({ token: "fixture" }) };
    if (name === "@/context/BrandContext") return { useBrand: () => ({ themeColor }) };
    if (name === "@/utils/phoneUtils") return { formatPhone: (s:any) => s };
    if (name.endsWith("/LucideIcon")) return { LucideIcon: "LucideIcon" };
    if (name.endsWith("/SubScreenHeader")) return { SubScreenHeader: "SubScreenHeader" };
    throw Error(`Unexpected import ${name}`);
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)(requireMock, module, module.exports);
  const render = () => { cursor = 0; return module.exports.default() as Element; };
  const nodes = (node:any): Element[] => {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object") return [];
    const children = [...nodes(node.props?.children), ...nodes(node.props?.ListEmptyComponent)];
    return [node, ...children];
  };
  const text = (tree:Element) => nodes(tree).filter(n => n.type === "Text").map(n => n.props.children).flat().join("|");
  return {
    render, nodes, text, values,
    mount: async () => {
      effect!();
      // The production effect starts load without returning its promise.
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
  };
}
const fixture = [
  { id: "approved", name: "Alpha", is_activated: true, invite_status: "approved" },
  { id: "inactive-approved", name: "Beta", is_activated: false, invite_status: "approved", is_admin_granted: true },
  { id: "pending", name: "Gamma", is_activated: false, invite_status: "joinedPendingApproval" },
  { id: "rejected", name: "Delta", is_activated: false, invite_status: "rejected" },
];
const ok = (body:any) => ({ ok: true, status: 200, json: async () => body });
for (const [mode, color] of [["Normal", "sage"], ["X", "navy"]]) {
  describe(`shared teacher list ${mode}`, () => {
    it("successful zero is the genuine empty state, without retry", async () => {
      const h = harness(vi.fn().mockResolvedValue(ok([])), color);
      h.render(); await h.mount(); const tree = h.render();
      expect(h.text(tree)).toContain("선생님이 없습니다");
      expect(h.text(tree)).not.toContain("불러오지 못했습니다");
      expect(h.text(tree)).not.toContain("다시 시도");
    });
    for (const error of ["timeout", "network", "http", "json", "shape"]) {
      it(`${error} shows error and retry, never a false empty list`, async () => {
        const fn = vi.fn();
        if (error === "http") fn.mockResolvedValue({ ok: false, status: 500 });
        else if (error === "json") fn.mockResolvedValue({ ok: true, json: async () => { throw Error("invalid JSON"); } });
        else if (error === "shape") fn.mockResolvedValue(ok({ success: false }));
        else fn.mockRejectedValue(Error(error));
        const h = harness(fn, color);
        h.render(); await h.mount(); const tree = h.render();
        expect(h.text(tree)).toContain("선생님 정보를 불러오지 못했습니다.");
        expect(h.text(tree)).toContain("다시 시도");
        expect(h.text(tree)).not.toContain("선생님이 없습니다");
        const retry = h.nodes(tree).find(n => n.props.accessibilityLabel === "다시 시도")!;
        expect(retry.props.accessibilityRole).toBe("button");
        expect(retry.props.style).toContainEqual({ borderColor: color });
      });
    }
    it("retry makes a fresh GET and displays returned teachers", async () => {
      const fn = vi.fn().mockRejectedValueOnce(Error("timeout")).mockResolvedValueOnce(ok(fixture));
      const h = harness(fn, color);
      h.render(); await h.mount();
      const retry = h.nodes(h.render()).find(n => n.props.accessibilityLabel === "다시 시도")!;
      const pending = retry.props.onPress();
      expect(h.nodes(h.render()).some(n => n.type === "ActivityIndicator")).toBe(true);
      await pending;
      const tree = h.render();
      expect(h.nodes(tree).find(n => n.type === "FlatList")!.props.data).toEqual(fixture);
      expect(h.text(tree)).not.toContain("불러오지 못했습니다");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith("fixture", "/admin/teachers", { _noCache: true });
    });
    it("all, approved, unapproved, admin and search filters retain their behavior", async () => {
      const h = harness(vi.fn().mockResolvedValue(ok(fixture)), color);
      h.render(); await h.mount();
      const data = () => h.nodes(h.render()).find(n => n.type === "FlatList")!.props.data;
      expect(data()).toHaveLength(4);
      for (const [filter, expected] of [
        ["승인됨", ["approved", "inactive-approved"]],
        ["미승인", ["pending", "rejected"]],
        ["관리자", ["inactive-approved"]],
        ["전체", fixture.map(t => t.id)],
      ]) {
        const tree = h.render();
        const chip = h.nodes(tree).find(n => n.type === "Pressable" && h.text(n) === filter)!;
        chip.props.onPress();
        expect(data().map((t:any) => t.id)).toEqual(expected);
      }
      h.nodes(h.render()).find(n => n.type === "TextInput")!.props.onChangeText("Alpha");
      expect(data().map((t:any) => t.id)).toEqual(["approved"]);
    });
    it("failed refresh hides stale results instead of claiming a successful empty load", async () => {
      const fn = vi.fn().mockResolvedValueOnce(ok(fixture)).mockRejectedValueOnce(Error("network"));
      const h = harness(fn, color);
      h.render(); await h.mount();
      const list = h.nodes(h.render()).find(n => n.type === "FlatList")!;
      await list.props.refreshControl.props.onRefresh();
      const tree = h.render();
      expect(h.text(tree)).toContain("불러오지 못했습니다");
      expect(h.nodes(tree).some(n => n.type === "FlatList")).toBe(false);
    });
  });
}
