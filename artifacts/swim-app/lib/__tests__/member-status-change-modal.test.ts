import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../..");
const componentSource = readFileSync(
  path.join(repositoryRoot, "artifacts/swim-app/components/common/MemberStatusChangeModal.tsx"),
  "utf8",
);
const compiledComponent = ts.transpileModule(componentSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

type NodeElement = { type: unknown; props: Record<string, any> };
type Props = {
  visible: boolean;
  studentId: string;
  studentName: string;
  currentStatus: string;
  onClose: () => void;
  onChanged: (result: { status: string; mode: string }) => void;
};

function createHarness(apiRequest: (...args: any[]) => Promise<any>) {
  const hookValues: any[] = [];
  let hookIndex = 0;
  const ReactMock = {
    useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] {
      const index = hookIndex++;
      if (index >= hookValues.length) hookValues[index] = initial;
      return [
        hookValues[index],
        next => {
          hookValues[index] = typeof next === "function"
            ? (next as (previous: T) => T)(hookValues[index])
            : next;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = hookIndex++;
      if (index >= hookValues.length) hookValues[index] = { current: initial };
      return hookValues[index] as { current: T };
    },
    createElement(type: unknown, props: Record<string, any> | null, ...children: any[]): NodeElement {
      const nextProps = { ...(props || {}) };
      if (children.length) nextProps.children = children.length === 1 ? children[0] : children;
      return { type, props: nextProps };
    },
    Fragment: "Fragment",
  };
  const Colors = {
    light: {
      success: "#16845B",
      textSecondary: "#555",
      text: "#222",
      card: "#fff",
      textMuted: "#888",
      brandStrong: "#158A72",
      primaryAction: "#158A72",
    },
  };
  const mockRequire = (specifier: string) => {
    if (specifier === "react") return ReactMock;
    if (specifier === "react-native") {
      return {
        Modal: "Modal",
        Pressable: "Pressable",
        ScrollView: "ScrollView",
        StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
        Text: "Text",
        View: "View",
      };
    }
    if (specifier === "@/components/common/LucideIcon") return { LucideIcon: "LucideIcon" };
    if (specifier === "@/constants/colors") return Colors;
    if (specifier === "@/context/AuthContext") {
      return { apiRequest, useAuth: () => ({ token: "test-token" }) };
    }
    throw new Error(`Unexpected component dependency: ${specifier}`);
  };

  const module = { exports: {} as Record<string, any> };
  const execute = new Function("require", "exports", "module", compiledComponent);
  execute(mockRequire, module.exports, module);
  const Component = module.exports.MemberStatusChangeModal;

  return {
    render(props: Props) {
      hookIndex = 0;
      return Component(props) as NodeElement;
    },
  };
}

function visit(node: any, callback: (element: NodeElement) => void): void {
  if (Array.isArray(node)) {
    node.forEach(child => visit(child, callback));
  } else if (node && typeof node === "object" && "type" in node && "props" in node) {
    callback(node as NodeElement);
    visit(node.props.children, callback);
  }
}

function textContent(node: any): string[] {
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (node && typeof node === "object" && "props" in node) return textContent(node.props.children);
  return [];
}

function findPressable(tree: NodeElement, label: string): NodeElement {
  let found: NodeElement | undefined;
  visit(tree, element => {
    if (!found && element.type === "Pressable" && textContent(element).includes(label)) found = element;
  });
  if (!found) throw new Error(`Could not find pressable labeled "${label}"`);
  return found;
}

async function pressText(tree: NodeElement, label: string): Promise<any> {
  return findPressable(tree, label).props.onPress?.();
}

function getTexts(tree: NodeElement): string[] {
  const texts: string[] = [];
  visit(tree, element => {
    if (element.type === "Text") texts.push(...textContent(element));
  });
  return texts;
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    visible: true,
    studentId: "student-1",
    studentName: "민지",
    currentStatus: "active",
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
}

describe("MemberStatusChangeModal withdrawal and status changes", () => {
  it("requires a final withdrawal confirmation and excludes next-month withdrawal", () => {
    const apiRequest = vi.fn().mockResolvedValue({ ok: true });
    const harness = createHarness(apiRequest);
    const props = baseProps();

    let tree = harness.render(props);
    void pressText(tree, "퇴원");
    tree = harness.render(props);

    const texts = getTexts(tree);
    expect(texts).toContain("퇴원 처리 확인");
    expect(texts).toContain("퇴원 처리 시 변경되는 내용");
    expect(texts.join(" ")).toContain("서비스·교육·미디어 데이터");
    expect(texts.join(" ")).toContain("보호자-학생 연결이 제거됩니다");
    expect(texts.join(" ")).toContain("지난 회원 정보와 수업일지 사본은 아카이브에 보존");
    expect(texts.join(" ")).toContain("출결·반 이력과 이미 발행된 월간 리포트는 유지");
    expect(texts.join(" ")).toContain("보호자 계정이나 다른 자녀의 정보는 삭제되지 않습니다");
    expect(texts).not.toContain("다음 달부터 이동");
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("guards duplicate submissions, blocks dismissal in flight, and closes only after success", async () => {
    let resolveRequest!: (response: any) => void;
    const pendingRequest = new Promise(resolve => { resolveRequest = resolve; });
    const apiRequest = vi.fn().mockReturnValue(pendingRequest);
    const events: string[] = [];
    const props = baseProps({
      onClose: vi.fn(() => events.push("close")),
      onChanged: vi.fn(() => events.push("changed")),
    });
    const harness = createHarness(apiRequest);

    let tree = harness.render(props);
    void pressText(tree, "퇴원");
    tree = harness.render(props);
    const confirmButton = findPressable(tree, "퇴원 처리");
    const requestPromise = confirmButton.props.onPress();
    confirmButton.props.onPress();
    expect(apiRequest).toHaveBeenCalledTimes(1);

    tree = harness.render(props);
    expect(getTexts(tree)).toContain("처리 중...");
    expect(findPressable(tree, "처리 중...").props.disabled).toBe(true);
    tree.props.onRequestClose();
    const overlay = (() => {
      let first: NodeElement | undefined;
      visit(tree, element => {
        if (!first && element.type === "Pressable" && !textContent(element).length) first = element;
      });
      return first;
    })();
    overlay?.props.onPress?.();
    expect(props.onClose).not.toHaveBeenCalled();

    resolveRequest({ ok: true });
    await requestPromise;
    expect(apiRequest).toHaveBeenCalledWith(
      "test-token",
      "/students/student-1/change-status",
      { method: "POST", body: JSON.stringify({ new_status: "withdrawn", effective_mode: "immediate" }) },
    );
    expect(events).toEqual(["close", "changed"]);
    expect(props.onChanged).toHaveBeenCalledWith({ status: "withdrawn", mode: "immediate" });
  });

  it("keeps a failed withdrawal visible with an error and retries successfully", async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: "서버 점검 중입니다." }) })
      .mockResolvedValueOnce({ ok: true });
    const props = baseProps();
    const harness = createHarness(apiRequest);

    let tree = harness.render(props);
    void pressText(tree, "퇴원");
    tree = harness.render(props);
    await pressText(tree, "퇴원 처리");
    tree = harness.render(props);

    expect(getTexts(tree)).toContain("서버 점검 중입니다.");
    expect(getTexts(tree)).toContain("퇴원 처리 확인");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onChanged).not.toHaveBeenCalled();

    await pressText(tree, "퇴원 처리");
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onChanged).toHaveBeenCalledWith({ status: "withdrawn", mode: "immediate" });
  });

  it("preserves suspended next-month scheduling", async () => {
    const apiRequest = vi.fn().mockResolvedValue({ ok: true });
    const props = baseProps();
    const harness = createHarness(apiRequest);

    let tree = harness.render(props);
    void pressText(tree, "연기");
    tree = harness.render(props);
    expect(getTexts(tree)).toContain("다음 달부터 이동");

    await pressText(tree, "다음 달부터 이동");
    expect(apiRequest).toHaveBeenCalledWith(
      "test-token",
      "/students/student-1/change-status",
      { method: "POST", body: JSON.stringify({ new_status: "suspended", effective_mode: "next_month" }) },
    );
    expect(props.onChanged).toHaveBeenCalledWith({ status: "suspended", mode: "next_month" });
  });

  it("shows a retryable network failure instead of silently closing", async () => {
    const apiRequest = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true });
    const props = baseProps();
    const harness = createHarness(apiRequest);
    let tree = harness.render(props);
    void pressText(tree, "퇴원");
    tree = harness.render(props);
    await pressText(tree, "퇴원 처리");
    tree = harness.render(props);
    expect(getTexts(tree)).toContain("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(findPressable(tree, "퇴원 처리").props.disabled).toBe(false);
    await pressText(tree, "퇴원 처리");
    expect(props.onChanged).toHaveBeenCalledOnce();
  });

  it("uses a visible fallback for a non-JSON server failure", async () => {
    const apiRequest = vi.fn().mockResolvedValue({
      ok: false, json: async () => { throw new Error("not JSON"); },
    });
    const props = baseProps();
    const harness = createHarness(apiRequest);
    let tree = harness.render(props);
    void pressText(tree, "퇴원");
    tree = harness.render(props);
    await pressText(tree, "퇴원 처리");
    tree = harness.render(props);
    expect(getTexts(tree)).toContain("상태 변경에 실패했습니다. 다시 시도해 주세요.");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  it("preserves the active return-date picker and submits its selected date", async () => {
    const apiRequest = vi.fn().mockResolvedValue({ ok: true });
    const props = baseProps();
    const harness = createHarness(apiRequest);

    let tree = harness.render(props);
    void pressText(tree, "정상");
    tree = harness.render(props);
    expect(getTexts(tree)).toContain("복귀일 선택");

    void pressText(tree, "15");
    tree = harness.render(props);
    const texts = getTexts(tree);
    const selectedLabelIndex = texts.findIndex(text => text.startsWith("선택: "));
    expect(selectedLabelIndex).toBeGreaterThanOrEqual(0);
    const selectedDate = texts[selectedLabelIndex + 1];
    expect(selectedDate).toMatch(/^\d{4}-\d{2}-15$/);
    await pressText(tree, "복귀 확인");

    expect(apiRequest).toHaveBeenCalledWith(
      "test-token",
      "/students/student-1/change-status",
      {
        method: "POST",
        body: JSON.stringify({
          new_status: "active",
          effective_mode: "immediate",
          resume_date: selectedDate,
        }),
      },
    );
    expect(props.onChanged).toHaveBeenCalledWith({ status: "active", mode: "immediate" });
  });
});