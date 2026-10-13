import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as selection from "../../utils/photoDragSelection";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const hookSource = readFileSync(path.join(root, "artifacts/swim-app/hooks/usePhotoDragSelection.ts"), "utf8");
const hookJS = ts.transpileModule(hookSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function harness(count = 180, initial: string[] = [], limit = Infinity) {
  const slots: any[] = [];
  const effects: any[] = [];
  const frames = new Map<number, (time: number) => void>();
  const offsets: number[] = [];
  let cursor = 0, frameId = 0, time = 0, appState: (state: string) => void;
  const options = {
    enabled: true, ids: Array.from({ length: count }, (_, i) => String(i)),
    selected: new Set(initial), limit, columns: 3, cellSize: 100,
    columnGap: 2, rowGap: 2, padding: 0,
    setSelected: (update: any) => { options.selected = update(options.selected); },
  };
  const react = {
    useRef: (value: any) => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: (value: any) => {
      const i = cursor++;
      slots[i] ??= { value };
      return [slots[i].value, (v: any) => { slots[i].value = v; }];
    },
    useEffect: (fn: () => any, deps: unknown[]) => {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((v, n) => v !== old.deps[n])) {
        old?.cleanup?.();
        effects[i] = { deps, cleanup: fn() };
      }
    },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "requestAnimationFrame", "cancelAnimationFrame", hookJS)(
    (name: string) => name === "react" ? react
      : name === "react-native" ? {
        AppState: { addEventListener: (_: string, cb: any) => { appState = cb; return { remove() {} }; } },
      } : selection,
    module, module.exports,
    (cb: any) => { frames.set(++frameId, cb); return frameId; },
    (id: number) => { frames.delete(id); },
  );
  let result: any;
  function render() {
    cursor = 0;
    result = module.exports.usePhotoDragSelection(options);
    result.containerProps.ref.current = { measureInWindow: (cb: any) => cb(0, 0, 306, 240) };
    result.listProps.ref.current = { scrollToOffset: ({ offset }: any) => offsets.push(offset) };
    result.containerProps.onLayout();
    result.listProps.onContentSizeChange(306, Math.ceil(count / 3) * 102);
    return result;
  }
  render();
  const event = (x: number, y: number, touches = 1) => ({
    nativeEvent: { pageX: x, pageY: y, touches: Array(touches).fill({}) },
  });
  return {
    options, offsets, frames, event, render,
    get result() { return result; },
    start: (id: string, x = 50, y = 50) => {
      const p = result.cellProps(id, () => {});
      p.onPressIn(); p.onLongPress(event(x, y)); render();
    },
    move: (x: number, y: number, touches = 1) => result.containerProps.onResponderMove(event(x, y, touches)),
    end: () => { result.containerProps.onResponderRelease(); render(); },
    advance: (n: number) => {
      for (let i = 0; i < n; i++) {
        time += 16;
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(cb => cb(time));
      }
    },
    background: () => { appState!("background"); render(); },
    dispose: () => effects.forEach(e => e?.cleanup?.()),
  };
}

describe("shared photo grid selection", () => {
  it("tap selects and a second tap deselects, without arming drag", () => {
    const h = harness();
    const tap = () => {
      const p = h.result.cellProps("0", () => {
        const next = new Set(h.options.selected);
        next.has("0") ? next.delete("0") : next.add("0");
        h.options.selected = next;
      });
      p.onPressIn(); p.onPress(); h.render();
    };
    tap(); expect([...h.options.selected]).toEqual(["0"]);
    tap(); expect(h.options.selected.size).toBe(0);
    expect(h.result.containerProps.onMoveShouldSetResponderCapture()).toBe(false);
    h.dispose();
  });
  it("horizontal 3x3 drag selects only crossed cells", () => {
    const h = harness(9); h.start("0"); h.move(254, 50);
    expect([...h.options.selected]).toEqual(["0", "1", "2"]); h.dispose();
  });
  it("diagonal and fast moves sample intermediate cells", () => {
    const h = harness(9); h.start("0"); h.move(254, 230);
    expect(h.options.selected.has("4")).toBe(true);
    expect(h.options.selected.has("8")).toBe(true); h.dispose();
  });
  it("selected start fixes deselect mode, even when crossing unselected cells", () => {
    const h = harness(9, ["0", "2"]); h.start("0"); h.move(254, 50);
    expect(h.options.selected.size).toBe(0); h.dispose();
  });
  it("reentry does not toggle twice", () => {
    const h = harness(9); h.start("0"); h.move(254, 50); h.move(50, 50); h.move(254, 50);
    expect([...h.options.selected]).toEqual(["0", "1", "2"]); h.dispose();
  });
  it("bottom edge scroll selects newly crossed rows and clamps at the end", () => {
    const h = harness(180); h.start("3", 50, 239); h.advance(700);
    expect(h.offsets.length).toBeGreaterThan(0);
    expect(h.options.selected.size).toBeGreaterThanOrEqual(50);
    expect(h.offsets.at(-1)).toBeLessThanOrEqual(60 * 102 - 240);
    h.end(); const n = h.offsets.length; h.advance(30);
    expect(h.offsets.length).toBe(n); expect(h.frames.size).toBe(0); h.dispose();
  });
  it("top edge scroll goes upward and selects rows during scroll", () => {
    const h = harness(); h.result.listProps.onScroll({ nativeEvent: { contentOffset: { y: 500 } } });
    h.start("12", 50, 1); h.advance(70);
    expect(h.offsets[0]).toBeLessThan(500);
    expect(h.offsets.at(-1)).toBe(0); expect(h.options.selected.has("0")).toBe(true); h.dispose();
  });
  it("hold disables native scrolling only while drag is active", () => {
    const h = harness();
    expect(h.result.listProps.scrollEnabled).toBe(true);
    h.start("0"); expect(h.result.listProps.scrollEnabled).toBe(false);
    expect(h.result.containerProps.onMoveShouldSetResponderCapture()).toBe(true);
    h.end(); expect(h.result.listProps.scrollEnabled).toBe(true); h.dispose();
  });
  it("all selected then partial drag deselect keeps count and targets exact", () => {
    const h = harness(9, Array.from({ length: 9 }, (_, i) => String(i)));
    h.start("0"); h.move(254, 50);
    expect([...h.options.selected]).toEqual(["3", "4", "5", "6", "7", "8"]); h.dispose();
  });
  it("some selected then select all, then another gesture uses latest selection", () => {
    const h = harness(9); h.start("0"); h.end();
    h.options.selected = new Set(h.options.ids); h.render(); h.start("0"); h.move(254, 50);
    expect(h.options.selected.size).toBe(6); h.dispose();
  });
  it("keeps existing diary limit and ignores video cells", () => {
    const h = harness(9, [], 2); h.options.ids[1] = null as any;
    h.start("0"); h.move(254, 230);
    expect(h.options.selected.size).toBe(2); expect(h.options.selected.has("1")).toBe(false); h.dispose();
  });
  it("does not invoke a trailing tap after a drag", () => {
    const h = harness(); let taps = 0;
    const cell = h.result.cellProps("0", () => taps++);
    cell.onPressIn(); cell.onLongPress(h.event(50, 50)); h.end(); cell.onPress();
    expect(taps).toBe(0); h.dispose();
  });
  it("disabled selection leaves long-press entry and normal scroll intact", () => {
    const h = harness(); h.options.enabled = false; h.render(); let entered = 0;
    h.result.cellProps("0", () => {}, () => entered++).onLongPress(h.event(50, 50));
    expect(entered).toBe(1); expect(h.options.selected.size).toBe(0);
    expect(h.frames.size).toBe(0); expect(h.result.listProps.scrollEnabled).toBe(true); h.dispose();
  });
  it("touch cancel, termination, background, close and unmount stop auto-scroll", () => {
    for (const reason of ["cancel", "terminate", "background", "close", "unmount", "multitouch"]) {
      const h = harness(); h.start("3", 50, 239);
      if (reason === "cancel") h.result.containerProps.onTouchCancel();
      if (reason === "terminate") h.result.containerProps.onResponderTerminate();
      if (reason === "background") h.background();
      if (reason === "close") { h.options.enabled = false; h.render(); }
      if (reason === "unmount") h.dispose();
      if (reason === "multitouch") h.move(50, 239, 2);
      h.advance(10); expect(h.frames.size, reason).toBe(0); expect(h.offsets.length, reason).toBe(0);
      h.dispose();
    }
  });
  it("respects gaps, margins, offset, incomplete final row and viewport boundaries", () => {
    const g = { columns: 3, cellSize: 100, columnGap: 4, rowGap: 4, padding: 3 };
    expect(selection.photoIndexAt(5, 5, 5, g)).toBe(0);
    expect(selection.photoIndexAt(105, 5, 5, g)).toBe(-1);
    expect(selection.photoIndexAt(109, 109, 5, g)).toBe(4);
    expect(selection.photoIndexAt(213, 109, 5, g)).toBe(-1);
    expect(selection.edgeScrollSpeed(-1, 240)).toBe(0);
    expect(selection.edgeScrollSpeed(241, 240)).toBe(0);
    expect(selection.edgeScrollSpeed(120, 240)).toBe(0);
  });
  it("integrates the one shared helper in all four screens without changing ordering contracts", () => {
    const sources = [
      "app/(teacher)/photos.tsx", "components/teacher/album/FullAlbumPickerModal.tsx",
      "components/teacher/diary/MyAlbumPickerModal.tsx", "components/teacher/diary/AlbumPickerModal.tsx",
    ].map(file => readFileSync(path.join(root, "artifacts/swim-app", file), "utf8"));
    for (const source of sources) {
      expect(source).toContain('from "@/hooks/usePhotoDragSelection"');
      expect(source).toContain("photoDrag.containerProps");
      expect(source).toContain("photoDrag.listProps");
      expect(source).toContain("photoDrag.cellProps");
    }
    expect(sources[0].match(/orderedSelection: !isVideo/g)).toHaveLength(2);
    expect(sources[1]).toContain("const ids = Array.from(selected)");
    expect(sources[2]).toContain("const selItems = items.filter(it => selected.has(it.id))");
    expect(sources[3]).toContain("photos: photos.filter(p => selPhotos.has(p.id))");
  });
});
