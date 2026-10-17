import { appendFile, writeFile } from "node:fs/promises";
const out = new URL("../../generated-artifacts/office-stage3-search-recheck/", import.meta.url);
export async function verifyNavigation({ cdp, evaluate }) {
  const log = async (id, result) => {
    await appendFile(new URL("navigation-results.jsonl", out), JSON.stringify({ id, ...result }) + "\n");
    console.log(id, result.pass ? "PASS" : "FAIL");
    if (!result.pass) throw new Error("First failure preserved: " + id);
  };
  const wait = async expression => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Navigation wait timeout: " + expression);
  };
  const screenshot = async name => {
    const img = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(name + ".png", out), Buffer.from(img.data, "base64"));
  };
  await wait("!!window.__officeFixture?.actions && !!document.querySelector('textarea')");
  // Prohibit paid requests in this entire phase, including accidental button submissions.
  await evaluate(`window.__navigationFetch=window.fetch;window.fetch=(...a)=>{
    if(String(a[0]).endsWith('/office/interpret'))throw Error('Paid inference forbidden in navigation acceptance');
    return window.__navigationFetch(...a)};
    window.__officeFixture.navigation.updateView({search:'합성',status:'active',classId:'fixture_a',page:1});`);
  await wait("document.querySelectorAll('tbody tr[data-office-member-open]').length>10");
  await evaluate(`(()=>{const el=document.querySelector('[data-office-business-scroll]');
    el.scrollTop=320;el.dispatchEvent(new Event('scroll'));
    const t=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'합성 AI 미전송 초안');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const { root } = await cdp("DOM.getDocument");
  const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
  await cdp("DOM.setFileInputFiles", { nodeId, files: [new URL("../../generated-artifacts/office-stage3-real-ai/synthetic-attachment.txt", import.meta.url).pathname] });
  await wait("window.__officeFixture.navigation.view.scroll>200");
  const before = await evaluate(`({...window.__officeFixture.navigation.view,
    actualScroll:document.querySelector('[data-office-business-scroll]').scrollTop})`);
  await log("list-state-set", { before, pass: before.search === "합성" && before.classId === "fixture_a" && before.scroll >= 200 });
  await screenshot("list-before-change");
  const mutate = async memo => evaluate(`(async()=>{const f=window.__officeFixture;
    const s=(await f.readMembers()).find(s=>s.id==='fixture_member');
    return f.actions.execute({action:'office.member.update',input:{memberId:s.id,requestId:'nav_'+crypto.randomUUID(),expectedRevision:s.office_revision,changes:{memo:${JSON.stringify(memo)}}}},'structured')})()`);
  const outcome = await mutate("합성 상태 보존 변경값");
  await log("ordinary-change-completed", { status: outcome.status, pass: outcome.status === "success" });
  await wait("window.__officeFixture.actions.tasks.some(t=>t.request==='회원정보 저장'&&t.status==='completed')");
  const task = await evaluate("window.__officeFixture.actions.tasks.find(t=>t.request==='회원정보 저장'&&t.status==='completed')");
  await evaluate(`window.__officeFixture.actions.openResult(${JSON.stringify(task.id)},${JSON.stringify(task.results[0].id)})`);
  await wait("window.__officeFixture.navigation.destination.memberId==='fixture_member'");
  const entered = await evaluate(`({destination:window.__officeFixture.navigation.destination,
    task:window.__officeFixture.actions.tasks.find(t=>t.id===${JSON.stringify(task.id)}),
    shown:document.body.innerText.includes('합성 상태 보존 변경값')})`);
  await log("result-current-data-and-read", { ...entered, pass: entered.shown && !!entered.task.results[0].viewedAt });
  await screenshot("result-after-change");
  await evaluate("window.__officeFixture.navigation.back()");
  await wait("!window.__officeFixture.navigation.destination.memberId && !!document.querySelector('input[placeholder=\"이름 또는 전화번호 검색\"]')");
  await wait(`Math.abs(document.querySelector('[data-office-business-scroll]').scrollTop-${before.actualScroll})<3`);
  const back = await evaluate(`(async()=>({view:window.__officeFixture.navigation.view,
    scroll:document.querySelector('[data-office-business-scroll]').scrollTop,
    input:document.querySelector('input[placeholder="이름 또는 전화번호 검색"]').value,
    draft:document.querySelector('textarea').value,
    attachment:document.body.innerText.includes('synthetic-attachment.txt'),
    memo:(await window.__officeFixture.readMembers()).find(s=>s.id==='fixture_member').memo}))()`);
  await log("back-restores-list-with-current-data", { ...back, pass: back.view.search === before.search &&
    back.view.status === before.status && back.view.classId === before.classId && back.view.page === before.page &&
    Math.abs(back.scroll - before.actualScroll) < 3 && back.input === before.search &&
    back.draft === "합성 AI 미전송 초안" && back.attachment && back.memo === "합성 상태 보존 변경값" });
  await screenshot("back-restored");
  await evaluate("window.__officeFixture.navigation.forward()");
  await wait("window.__officeFixture.navigation.destination.memberId==='fixture_member' && document.body.innerText.includes('합성 상태 보존 변경값')");
  await log("forward-current-detail", { pass: await evaluate(`document.querySelector('textarea').value==='합성 AI 미전송 초안'&&document.body.innerText.includes('synthetic-attachment.txt')`) });
  const next = await mutate("합성 미열람 보존값");
  await log("second-change-for-read-fault", { pass: next.status === "success" });
  const unread = await evaluate("window.__officeFixture.actions.tasks.filter(t=>t.request==='회원정보 저장'&&t.status==='completed').at(-1)");
  await evaluate(`(()=>{const original=window.fetch;window.fetch=(...a)=>{
    if(String(a[0]).includes('/students?pool_all')){window.fetch=original;return Promise.reject(Error('Synthetic result GET failure'))}
    return original(...a)}})()`);
  await evaluate(`window.__officeFixture.actions.openResult(${JSON.stringify(unread.id)},${JSON.stringify(unread.results[0].id)})`);
  const failedRead = await evaluate(`window.__officeFixture.actions.tasks.find(t=>t.id===${JSON.stringify(unread.id)})`);
  await log("failed-result-remains-unread", { task: failedRead, pass: failedRead.results[0].viewedAt === undefined });
  await screenshot("failed-result-unread");
  await evaluate("window.__officeFixture.switchActor('fixture_eval_1')");
  await wait("window.__officeFixture.actions.tasks.length===0 && document.querySelector('textarea')?.value===''");
  const isolation = await evaluate(`(async()=>{const f=window.__officeFixture;const old=await f.actions.core.openTaskResult(${JSON.stringify(unread.id)},${JSON.stringify(unread.results[0].id)});
    let receiptStatus;try{await f.readReceipt(${JSON.stringify(next.receipt.requestId)});receiptStatus=200}catch(e){receiptStatus=e.status}
    return {old:old.status,receiptStatus,tasks:f.actions.tasks.length,draft:document.querySelector('textarea').value,
      attachment:document.body.innerText.includes('synthetic-attachment.txt')};})()`);
  await log("session-isolation", { ...isolation, pass: isolation.old === "failed" && [403,404].includes(isolation.receiptStatus) &&
    isolation.tasks === 0 && isolation.draft === "" && !isolation.attachment });
  await screenshot("new-session-isolated");
}
