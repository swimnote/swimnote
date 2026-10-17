/** Session-owned bridge into the existing Action core, not a second business service. */
type Operation = { path: string; method: string; body?: string };
type Handler = (operation: Operation) => Promise<unknown>;
let handler: Handler | undefined;
export function registerOfficeOperations(next: Handler) {
  handler = next;
  return () => { if (handler === next) handler = undefined; };
}
export function runOfficeOperation(operation: Operation) {
  if (!handler) return Promise.reject({ status: 403, message: "현재 로그인 업무 연결을 확인하지 못했습니다. 실행하지 않았습니다." });
  return handler(operation);
}
