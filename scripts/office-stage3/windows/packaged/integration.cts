import { app, dialog, shell, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { generateSync } from "otplib";
import { IsolatedRuntime } from "./runtime.cjs";

declare const __PACKAGED_ID__: string;
export const packagedId = __PACKAGED_ID__;
let runtime: any, quitting = false, exitAllowed = false, failureShown = false;

async function failure(error: unknown) {
  if (failureShown) return;
  failureShown = true;
  let location = "", code = "STARTUP_FAILED";
  if (runtime) runtime.failureStage ??= runtime.stage;
  try { const result = runtime.diagnose(error); location = result.file; code = result.code; } catch { /* No raw fallback logging. */ }
  try { await runtime?.stop({ preserveEvidence: true }); } catch (stopError: any) {
    if (runtime) {
      runtime.shutdownOutcome ??= "STOP_FAILED";
      runtime.shutdownErrorCode = stopError?.code;
    }
  }
  let status: any;
  do {
    try { status = runtime?.inspectResources(); } catch { status = undefined; }
    try { const result = runtime.diagnose(error, { currentStatus: true }); location = result.file; code = result.code; } catch { /* Original evidence is preserved. */ }
    const lines = (status?.resources ?? []).map((resource: any) =>
      `${resource.scope === "PREVIOUS" ? "이전 검증본" : "이번 검증본"}: ` +
      `${resource.processState === "ABSENT" ? "해당 프로세스 없음" : resource.verified ? "소유권 확인됨" : "소유권 미확인 — 보존"} ` +
      `[${resource.reason}]`);
    const buttons = ["상태 다시 확인"];
    if (status?.canStop) buttons.push("소유 확인된 DB 정상 종료");
    if (location) buttons.push("진단 폴더 열기");
    buttons.push("종료");
    const result = await dialog.showMessageBox({
    type: "error", title: "SWIMNOTE OFFICE 격리 검증본",
    message: "검증 환경을 시작하거나 정상 종료하지 못했습니다.",
    detail: `오류: ${code}\n종료 처리: ${status?.shutdown ?? "확인 불가"}\n` +
      lines.join("\n") + "\n미확인 프로세스·이전 잠금·실패 DB는 변경하지 않습니다.\n" +
      "자동 재기동하지 않습니다. 미확인 상태면 해당 앱을 정상 종료하거나 이 진단만 전달해 주세요.\n" +
      "재설치·보안 해제·터미널 명령을 실행하지 마세요.\n" +
      (location ? `다음 진단 JSON만 전달해 주세요:\n${location}` : "진단 파일을 만들지 못했습니다. 이 오류 코드만 전달해 주세요.") +
      "\nprivate.json, login-info, DB, userData는 공유하지 마세요.",
    buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1,
    noLink: true,
  });
    const action = buttons[result.response];
    if (action === "종료") break;
    if (action === "진단 폴더 열기") shell.showItemInFolder(location);
    if (action === "소유 확인된 DB 정상 종료") {
      try { await runtime.stop({ preserveEvidence: true, allowRetained: true }); }
      catch (stopError: any) { runtime.shutdownErrorCode = stopError?.code; }
    }
  } while (true);
  exitAllowed = true;
  app.quit();
}
export async function startIsolation() {
  const identity = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "isolation", "package-identity.json"), "utf8"));
  if (identity.packageId !== packagedId) throw new Error("Package identity mismatch");
  runtime = new IsolatedRuntime({ resources: process.resourcesPath,
    localData: process.env.LOCALAPPDATA, identity, nodeVersion: process.version });
  runtime.onFailure = failure;
  app.on("before-quit", event => {
    if (exitAllowed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    runtime.stop().then(() => { exitAllowed = true; app.quit(); }).catch(failure);
  });
  try { await runtime.start(); } catch (error) { await failure(error); throw new Error("Isolated startup stopped"); }
}
export function registerLocalHelp(window: BrowserWindow) {
  window.setTitle("SWIMNOTE OFFICE — 격리 검증본 (운영 연결 없음)");
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "l") {
      event.preventDefault();
      void showLocalHelp();
    }
  });
}
export async function showLocalHelp() {
  if (!runtime || runtime.stage !== "ready") return;
  const result = await dialog.showMessageBox({
    type: "info", title: "격리 검증본 — 로컬 로그인 안내",
    message: "운영 계정이 아닌 새 합성 계정으로 로그인하세요.",
    detail: "로그인 ID / 지정 Pool ID: fixture_pool\n비밀번호와 PIN: 아래 버튼으로 보호된 로컬 안내 파일에서 확인\n" +
      "다른 Pool·제한 역할·TOTP 계정도 같은 파일에 있습니다.\n\n" +
      "이 창 다시 열기: Ctrl+Shift+L\n기록된 AI 입력만 사용하며 실제 발송·결제·업로드는 지원하지 않습니다.\n" +
      "창을 정상 종료하면 이번 실행이 시작한 API·DB만 종료합니다.\n로그인 정보·OTP·DB·userData는 외부로 공유하지 마세요.",
    buttons: ["로그인 정보 열기", "현재 TOTP 보기", "닫기"], defaultId: 0, cancelId: 2, noLink: true,
  });
  if (result.response === 0) {
    const error = await shell.openPath(path.join(runtime.run, "login-info.txt"));
    if (error) await dialog.showMessageBox({ type: "warning", message: "안내 파일을 열지 못했습니다.",
      detail: "로컬 안내 파일 위치:\n" + path.join(runtime.run, "login-info.txt"), buttons: ["확인"] });
  }
  if (result.response === 1) {
    const account = runtime.credentials.accounts.find((a: any) => a.totpSecret);
    const code = generateSync({ secret: account.totpSecret });
    await dialog.showMessageBox({ type: "info", title: "합성 TOTP — 외부 공유 금지",
      message: String(code), detail: "isolation_totp 계정용 현재 코드입니다. 만료되면 다시 확인하세요.",
      buttons: ["닫기"] });
  }
}
export const packagingFailure = failure;
