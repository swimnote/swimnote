/**
 * Focused regression coverage for StudentPickerModal in app/(admin)/approvals.tsx.
 * Run from artifacts/swim-app: pnpm exec vitest run lib/__tests__/student-picker-no-search.test.ts
 *
 * The component is extracted from the real TSX AST, transpiled, and invoked with a
 * small React-hook/React-Native element harness. Effects retain dependency arrays
 * and run their prior cleanup before a changed effect, as React does.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../..");
const sourcePath = path.join(repositoryRoot, "artifacts/swim-app/app/(admin)/approvals.tsx");
const approvalsSource = readFileSync(sourcePath, "utf8");

function findFunction(source: string, name: string): ts.FunctionDeclaration {
  const sourceFile = ts.createSourceFile("approvals.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`Could not find ${name} in approvals.tsx`);
  return found;
}

const pickerDeclaration = findFunction(approvalsSource, "StudentPickerModal");
const pickerSource = pickerDeclaration.getText(
  ts.createSourceFile("approvals.tsx", approvalsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
);
const pickerJavascript = ts.transpileModule(
  `${pickerSource}\nthis.StudentPickerModal = StudentPickerModal;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;

type ElementNode = {
  type: unknown;
  props: Record<string, any>;
};
type HookState = {
  kind: "state";
  value: unknown;
} | {
  kind: "effect";
  dependencies?: unknown[];
  cleanup?: () => void;
};

function createPickerHarness(
  apiRequest: ReturnType<typeof vi.fn>,
  initialProps: { visible: boolean; processing: boolean; onSelect?: (student: any) => void },
) {
  const hooks: HookState[] = [];
  const styleTokens = {
    overlay: "overlay-style",
    sheet: "sheet-style",
    header: "header-style",
    title: "title-style",
    empty: "empty-style",
    list: "list-style",
    row: "row-style",
    rowLeft: "row-left-style",
    rowName: "row-name-style",
    rowSub: "row-sub-style",
  };
  const componentTypes = [
    "ActivityIndicator", "FlatList", "Modal", "Pressable", "Text", "View",
  ];
  const nativeTypes = Object.fromEntries(componentTypes.map(type => [type, type]));
  let hookIndex = 0;
  let pendingEffects: Array<{ index: number; create: () => void | (() => void); dependencies?: unknown[] }> = [];
  let props = initialProps;
  let dirty = true;
  let flushing = false;
  let tree: ElementNode | undefined;

  const scheduleRender = () => {
    dirty = true;
    if (!flushing) flush();
  };

  const React = {
    Fragment: "Fragment",
    createElement(type: unknown, elementProps: Record<string, any> | null, ...children: unknown[]) {
      const flattened = children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false);
      return {
        type,
        props: {
          ...(elementProps ?? {}),
          ...(flattened.length ? { children: flattened.length === 1 ? flattened[0] : flattened } : {}),
        },
      };
    },
  };

  const runtime: Record<string, any> = {
    React,
    ...nativeTypes,
    ActivityIndicator: "ActivityIndicator",
    FlatList: "FlatList",
    LucideIcon: "LucideIcon",
    Modal: "Modal",
    Pressable: "Pressable",
    Text: "Text",
    View: "View",
    C: {
      background: "background",
      border: "border",
      brandStrong: "brand",
      card: "card",
      text: "text",
      textMuted: "muted",
    },
    sp: styleTokens,
    apiRequest,
    useAuth: () => ({ token: "auth-token" }),
    useState(initialValue: unknown) {
      const index = hookIndex++;
      if (!hooks[index]) {
        hooks[index] = { kind: "state", value: typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue };
      }
      const state = hooks[index] as Extract<HookState, { kind: "state" }>;
      return [
        state.value,
        (nextValue: unknown) => {
          const value = typeof nextValue === "function"
            ? (nextValue as (previous: unknown) => unknown)(state.value)
            : nextValue;
          if (!Object.is(value, state.value)) {
            state.value = value;
            scheduleRender();
          }
        },
      ];
    },
    useEffect(create: () => void | (() => void), dependencies?: unknown[]) {
      const index = hookIndex++;
      if (!hooks[index]) hooks[index] = { kind: "effect" };
      pendingEffects.push({ index, create, dependencies });
    },
  };

  const StudentPickerModal = (() => {
    vm.runInNewContext(pickerJavascript, runtime, { filename: "StudentPickerModal.transpiled.js" });
    return runtime.StudentPickerModal as (nextProps: typeof props) => ElementNode;
  })();

  function flush() {
    if (flushing) return;
    flushing = true;
    let iterations = 0;
    try {
      while (dirty && iterations++ < 50) {
        dirty = false;
        hookIndex = 0;
        pendingEffects = [];
        tree = StudentPickerModal(props);
        const effects = pendingEffects;
        for (const effect of effects) {
          const hook = hooks[effect.index] as Extract<HookState, { kind: "effect" }>;
          const dependenciesChanged = effect.dependencies === undefined
            || hook.dependencies === undefined
            || effect.dependencies.length !== hook.dependencies.length
            || effect.dependencies.some((dependency, index) => !Object.is(dependency, hook.dependencies?.[index]));
          if (!dependenciesChanged) continue;
          hook.cleanup?.();
          hook.dependencies = effect.dependencies?.slice();
          hook.cleanup = effect.create() || undefined;
        }
      }
      if (iterations >= 50) throw new Error("Hook harness exceeded its render limit");
    } finally {
      flushing = false;
    }
  }

  function update(nextProps: Partial<typeof props>) {
    props = { ...props, ...nextProps };
    scheduleRender();
  }

  flush();
  return {
    get tree() {
      return tree as ElementNode;
    },
    update,
    styleTokens,
  };
}

function findNodes(node: unknown, type: unknown): ElementNode[] {
  if (!node || typeof node !== "object") return [];
  const element = node as ElementNode;
  const own = element.type === type ? [element] : [];
  const children = element.props?.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return own.concat(...childNodes.map(child => findNodes(child, type)));
}

function renderedText(node: unknown): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (!node || typeof node !== "object") return [];
  const children = (node as ElementNode).props?.children;
  return (Array.isArray(children) ? children : [children]).flatMap(renderedText);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function drainPromiseHandlers() {
  // A macrotask runs only after the fetch + response.json await chain and its
  // finally handler have drained, independent of how many awaits are inside it.
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe("StudentPickerModal no-search behavior", () => {
  it("fetches the bare student list immediately when opened, filters ineligible students, and preserves class rows in a FlatList", async () => {
    const request = deferred<any>();
    const apiRequest = vi.fn(() => request.promise);
    const onSelect = vi.fn();
    const harness = createPickerHarness(apiRequest, { visible: false, processing: false, onSelect });

    expect(apiRequest).not.toHaveBeenCalled();
    harness.update({ visible: true });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("auth-token", "/students");
    expect(apiRequest.mock.calls[0]).toEqual(["auth-token", "/students"]);
    expect(findNodes(harness.tree, "ActivityIndicator")).toHaveLength(1);

    const students = [
      { id: "active-1", name: "Ari", status: "active", class_group_name: "Dolphins" },
      { id: "active-2", name: "Bo", status: "active", class_group_name: null },
      { id: "withdrawn", name: "Withdrawn", status: "withdrawn", class_group_name: "Old class" },
      { id: "archived", name: "Archived", status: "archived", class_group_name: null },
      { id: "deleted", name: "Deleted", status: "deleted", class_group_name: null },
    ];
    request.resolve({ ok: true, json: async () => students });
    await drainPromiseHandlers();

    const list = findNodes(harness.tree, "FlatList")[0];
    expect(findNodes(harness.tree, "ActivityIndicator")).toHaveLength(0);
    expect(list).toBeDefined();
    expect(list.props.data.map((student: any) => student.id)).toEqual(["active-1", "active-2"]);
    expect(list.props.data[0]).toMatchObject({ class_name: "Dolphins" });
    expect(list.props.style).toBe(harness.styleTokens.list);

    const firstRow = list.props.renderItem({ item: list.props.data[0] });
    expect(renderedText(firstRow)).toContain("Dolphins");
    const rowPressable = findNodes(firstRow, "Pressable")[0];
    expect(rowPressable.props.disabled).toBe(false);
    rowPressable.props.onPress();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "active-1", class_name: "Dolphins" }));

    const componentText = pickerDeclaration.getText(
      ts.createSourceFile("approvals.tsx", approvalsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    );
    expect(findNodes(harness.tree, "TextInput")).toHaveLength(0);
    expect(componentText).not.toMatch(/\b(TextInput|Keyboard|autoFocus)\b/);
  });

  it("shows an explicit empty state and disables each actual row while processing", async () => {
    const request = deferred<any>();
    const apiRequest = vi.fn(() => request.promise);
    const harness = createPickerHarness(apiRequest, { visible: true, processing: false });
    request.resolve({
      ok: true,
      json: async () => [{ id: "student-1", name: "Ari", status: "active", class_group_name: "Dolphins" }],
    });
    await drainPromiseHandlers();

    harness.update({ processing: true });
    const list = findNodes(harness.tree, "FlatList")[0];
    const row = list.props.renderItem({ item: list.props.data[0] });
    expect(findNodes(row, "Pressable")[0].props.disabled).toBe(true);

    const emptyRequest = deferred<any>();
    const emptyApiRequest = vi.fn(() => emptyRequest.promise);
    const emptyHarness = createPickerHarness(emptyApiRequest, { visible: true, processing: false });
    emptyRequest.resolve({ ok: true, json: async () => [] });
    await drainPromiseHandlers();
    expect(findNodes(emptyHarness.tree, "FlatList")[0].props.data).toEqual([]);
    expect(renderedText(emptyHarness.tree).some(text => text !== "학생 선택" && /(없|비어)/.test(text))).toBe(true);
  });

  it("shows a visible error state, ignores results after hiding, and does not fetch while hidden", async () => {
    const errorRequest = deferred<any>();
    const errorApiRequest = vi.fn(() => errorRequest.promise);
    const errorHarness = createPickerHarness(errorApiRequest, { visible: true, processing: false });
    errorRequest.reject(new Error("network failure"));
    await drainPromiseHandlers();
    expect(findNodes(errorHarness.tree, "ActivityIndicator")).toHaveLength(0);
    expect(renderedText(errorHarness.tree).some(text => /오류|불러|실패|error|network failure/i.test(text))).toBe(true);

    const staleRequest = deferred<any>();
    const staleApiRequest = vi.fn(() => staleRequest.promise);
    const staleHarness = createPickerHarness(staleApiRequest, { visible: false, processing: false });
    expect(staleApiRequest).not.toHaveBeenCalled();
    staleHarness.update({ visible: true });
    expect(staleApiRequest).toHaveBeenCalledTimes(1);
    staleHarness.update({ visible: false });
    staleRequest.resolve({
      ok: true,
      json: async () => [{ id: "late-student", name: "Late", status: "active", class_group_name: "Late class" }],
    });
    await drainPromiseHandlers();
    expect(findNodes(staleHarness.tree, "FlatList")[0].props.data).toEqual([]);
    expect(renderedText(staleHarness.tree)).not.toContain("Late");
  });
});

describe("parent approval handlers stay unchanged", () => {
  it("matches the approved baseline handlers and keeps the selected student id in the PATCH payload", () => {
    const baseline = execFileSync(
      "git",
      ["show", "52f5529:artifacts/swim-app/app/(admin)/approvals.tsx"],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    for (const name of ["handleParentApprove", "handleStudentSelected", "doApprove", "handleParentReject"]) {
      expect(findFunction(approvalsSource, name).getText()).toBe(findFunction(baseline, name).getText());
    }

    const approvalFunction = findFunction(approvalsSource, "doApprove").getText();
    expect(approvalFunction).toContain("body.student_id = studentId");
    expect(approvalFunction).toContain('method: "PATCH"');
  });
});