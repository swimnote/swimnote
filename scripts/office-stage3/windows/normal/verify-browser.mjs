import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "../../../.."), out = path.join(root, "generated-artifacts/office-normal-auth-check");
const folder = fs.readFileSync(out + "/run-path.txt", "utf8"), state = JSON.parse(fs.readFileSync(folder + "/private.json"));
const { Pool } = createRequire(root + "/scripts/package.json")("pg");
const pool = new Pool({ host: "127.0.0.1", port: 55440, database: "office_stage3_acceptance", user: "office_fixture",
  password: state.dbPassword, options: "-c search_path=office_acceptance -c client_encoding=UTF8" });
const tabs = await (await fetch("http://127.0.0.1:20413/json")).json();
const socket = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
await new Promise((resolve,reject) => { socket.onopen = resolve; socket.onerror = reject; });
let seq = 0; const pending = new Map(), results = [];
socket.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({id,method,params})); });
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  // Deliberately do NOT print the expression or exception object; a login expression contains synthetic secrets.
  if (response.error || response.result?.exceptionDetails) throw new Error("Browser evaluation failed; expression/exception withheld");
  return response.result.result.value;
}
async function wait(expression) {
  for (let n=0;n<100;n++) { if (await evaluate(expression)) return; await new Promise(r=>setTimeout(r,100)); }
  throw new Error("Browser state wait failed; expression withheld");
}
const record = name => { results.push({name,pass:true}); console.log("PASS " + name); };
const fault = config => { const f = folder + "/fault-control.json"; fs.writeFileSync(f,JSON.stringify({...JSON.parse(fs.readFileSync(f)),...config})); };
async function login(account) {
  const status = await evaluate(`(async()=>{const a=${JSON.stringify(account)},c=window.__normalController;await c.prepareLogin();
    const post=async(p,b)=>{const r=await fetch('http://127.0.0.1:20411/api/auth/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw Error('login denied');return r.json()};
    let b=await post('login',{email:a.identifier||a.email,password:a.password,web_login:true});
    if(b.web_pin_required)b=await post('web-pin/verify',{web_session:b.web_session,web_pin:a.pin});
    await c.accept(b.token,false);return c.getSnapshot().status})()`);
  assert.equal(status,"authenticated"); await wait("!!window.__normalProbe?.actions&&!!document.querySelector('textarea')");
}
async function mutate(memo, requestId) {
  return evaluate(`(async()=>{const f=window.__normalProbe,s=(await f.readMembers()).find(x=>x.id==='fixture_member');
    window.__normalPending={memberId:s.id,requestId:${JSON.stringify(requestId)},expectedRevision:s.office_revision,changes:{memo:${JSON.stringify(memo)}}};
    return f.actions.execute({action:'office.member.update',input:window.__normalPending},'structured')})()`);
}
async function screenshot(name) { const image = await cdp("Page.captureScreenshot",{format:"png"}); fs.writeFileSync(out + "/screenshots/" + name + ".png",Buffer.from(image.result.data,"base64"),{flag:"wx"}); }
try {
  await login(state.accounts[0]); record("real HTTP PIN login -> actual DesktopSessionController/AuthProvider authenticated UI");
  const requestId = "browser_" + crypto.randomUUID();
  const before = Number((await pool.query("SELECT count(*) n FROM pool_event_logs")).rows[0].n);
  fault({writes:true,dropNext:true});
  const lost = await mutate("합성 UI 응답 유실 검증 " + requestId.slice(-8),requestId); assert.equal(lost.status,"unknown");
  await wait("window.__normalProbe.actions.tasks.some(t=>t.status==='unknown')");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM pool_event_logs")).rows[0].n),before+1);
  const requestsBefore = Number((await pool.query("SELECT count(*) n FROM office_command_receipts")).rows[0].n);
  await new Promise(r=>setTimeout(r,400));
  assert.equal(Number((await pool.query("SELECT count(*) n FROM office_command_receipts")).rows[0].n),requestsBefore);
  const retried = await evaluate(`window.__normalProbe.actions.execute({action:'office.member.update',input:window.__normalPending},'structured')`);
  assert.equal(retried.status,"unknown");
  assert.equal(Number((await pool.query("SELECT count(*) n FROM office_command_receipts")).rows[0].n),requestsBefore);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM pool_event_logs")).rows[0].n),before+1);
  await screenshot("response-lost-unknown");
  record("UI unknown; no automatic/repeated issue or write; DB event exactly once");
  fault({writes:false});
  await evaluate(`window.__normalProbe.actions.resolveWrite(${JSON.stringify(requestId)})`);
  await wait("window.__normalProbe.actions.tasks.some(t=>t.status==='completed')");
  const task = await evaluate("window.__normalProbe.actions.tasks.find(t=>t.status==='completed')");
  const receiptId = (await pool.query("SELECT request_id FROM office_command_receipts WHERE completed_at IS NOT NULL ORDER BY issued_at DESC LIMIT 1")).rows[0].request_id;
  record("same issued receipt recovers UI while new execution is OFF");
  // Fail the result's actual current-members read once, in the Linux browser transport only.
  // Windows equivalent uses offline mode in this dedicated verification window, not an OS firewall/proxy.
  await evaluate(`(()=>{const original=window.fetch;window.fetch=(...a)=>{if(String(a[0]).includes('/students?pool_all')){window.fetch=original;return Promise.reject(Error('isolated result read failure'))}return original(...a)}})()`);
  await evaluate(`window.__normalProbe.actions.openResult(${JSON.stringify(task.id)},${JSON.stringify(task.results[0].id)})`);
  const failed = await evaluate(`window.__normalProbe.actions.tasks.find(t=>t.id===${JSON.stringify(task.id)})`);
  assert.equal(failed.results[0].viewedAt,undefined); record("result-only member read failure preserves unread");
  await evaluate(`(()=>{const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'합성 세션 교체 전 초안');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const file = path.join(out,"synthetic-session-attachment.txt"); fs.writeFileSync(file,"합성 로컬 첨부; 전송하지 않음",{flag:"wx"});
  const doc = await cdp("DOM.getDocument"), selected = await cdp("DOM.querySelector",{nodeId:doc.result.root.nodeId,selector:"input[type=file]"});
  await cdp("DOM.setFileInputFiles",{nodeId:selected.result.nodeId,files:[file]});
  await wait("document.body.innerText.includes('synthetic-session-attachment.txt')");
  await screenshot("before-session-change");
  await evaluate("window.__normalController.logout()"); await wait("window.__normalController.getSnapshot().status==='login'");
  await login(state.accounts.find(a=>a.id==="isolation_other"));
  assert.equal(await evaluate("window.__normalProbe.actions.tasks.length"),0);
  assert.equal(await evaluate("document.querySelector('textarea').value"),"");
  assert.equal(await evaluate("document.body.innerText.includes('synthetic-session-attachment.txt')"),false);
  const status = await evaluate(`(async()=>{try{await window.__normalProbe.receipt(${JSON.stringify(receiptId)});return 200}catch(e){return e.status}})()`);
  assert.ok([403,404].includes(status));
  await screenshot("after-session-change");
  record("actual logout + different real Pool login clears cards/draft/attachment and denies prior receipt");
  fs.writeFileSync(out + "/normal-browser-evidence.json",JSON.stringify({passed:true,results,realAuthentication:true,nativeBridge:"Linux in-memory stub only",windows:"NOT RUN",newPaidCalls:0},null,2),{flag:"wx"});
} finally { socket.close(); await pool.end(); }
