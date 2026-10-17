import { appendFile, readFile, mkdir, writeFile } from "node:fs/promises";
const out = new URL("../../generated-artifacts/office-stage3-search-recheck/", import.meta.url);
const file = new URL("browser-search-results.jsonl", out);
export async function verifySearch({ cdp, evaluate }) {
  await mkdir(out, { recursive: true });
  try { if ((await readFile(file, "utf8")).trim()) throw new Error("Preserve first search run; do not repeat"); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  const wait = async expression => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error("Browser state timeout: " + expression);
  };
  const screenshot = async name => {
    const img = await cdp("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(name + ".png", out), Buffer.from(img.data, "base64"));
  };
  await wait("!!window.__officeFixture?.actions && !!document.querySelector('textarea')");
  await evaluate(`window.__searchResponses=[];window.__fixtureFetch=window.fetch;
    window.fetch=async(...a)=>{const r=await window.__fixtureFetch(...a);
      if(String(a[0]).endsWith('/office/interpret')) window.__searchResponses.push({status:r.status,body:await r.clone().json()});return r;}`);
  const cases = [
    { id: "mixed", text: '"합성 검증 회원" 검색하고 메모를 합성 변경으로 수정해줘.', kind: "clarify" },
    { id: "exact-unquoted", text: "합성 검증 회원 이름 검색만 해줘. 아무것도 변경하지 마.", kind: "search", search: "합성 검증 회원", count: 1 },
    { id: "exact-quoted", text: '"합성 검증 회원" 이름 검색만 해줘.', kind: "search", search: "합성 검증 회원", count: 1 },
    { id: "find-variation", text: '"합성 검증 회원" 회원 찾아줘.', kind: "search", search: "합성 검증 회원", count: 1 },
    { id: "phone-show-variation", text: '"010-0000-3333" 정보 보여줘.', kind: "search", search: "01000003333", count: 1 },
    { id: "homonym", text: '"합성동명" 검색만 해줘.', kind: "search", search: "합성동명", count: 2 },
    { id: "missing", text: '"합성없는회원" 이름 검색만 해줘.', kind: "search", search: "합성없는회원", count: 0, actor: "fixture_eval_0" },
  ];
  for (const c of cases) {
    if (c.actor) {
      await evaluate(`window.__officeFixture.switchActor(${JSON.stringify(c.actor)})`);
      await wait(`window.__officeFixture?.actions?.core && document.querySelector('textarea')?.value===''`);
    }
    const previous = await evaluate("window.__searchResponses.length");
    const beforeTasks = await evaluate("window.__officeFixture.actions.tasks.length");
    await evaluate(`(()=>{const t=document.querySelector('textarea[placeholder="업무 내용을 입력하세요"]');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(c.text)});
      t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await appendFile(file, JSON.stringify({ event: "submission", id: c.id, text: c.text }) + "\n");
    await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='전송');
      if(!b || b.disabled)throw Error('Submit disabled');b.click()})()`);
    await wait(`window.__searchResponses.length>${previous}`);
    const response = await evaluate(`window.__searchResponses[${previous}]`);
    let observed;
    if (response.status === 200 && response.body.kind === "search") {
      await wait(`window.__officeFixture.actions.tasks.length>${beforeTasks} &&
        window.__officeFixture.actions.tasks.some(t=>t.status==='completed'&&t.summary.includes('조회 성공'))`);
      observed = await evaluate(`({rows:[...document.querySelectorAll('tbody tr[data-office-member-open]')].map(r=>r.innerText),
        selected:window.__officeFixture.navigation.destination.memberId??null,
        cards:window.__officeFixture.actions.tasks.map(t=>({summary:t.summary,status:t.status}))})`);
    } else observed = await evaluate(`({notice:window.__officeFixture.actions.notice,selected:window.__officeFixture.navigation.destination.memberId??null})`);
    const pass = response.status === 200 && response.body.kind === c.kind && observed.selected === null &&
      (c.kind !== "search" || response.body.search === c.search && observed.rows.length === c.count);
    await appendFile(file, JSON.stringify({ event: "result", id: c.id, response, observed, pass }) + "\n");
    console.log(c.id, response.status, response.body.kind, observed.rows?.length ?? "blocked", pass ? "PASS" : "FAIL");
    await screenshot(c.id);
    if (!pass) { console.log("FIRST FAILURE PRESERVED; no paid rerun"); break; }
  }
}
