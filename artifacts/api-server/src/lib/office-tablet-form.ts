/** No admin shell, account cookies, or privileged API surface. Token stays in URL fragment/session memory. */
export function tabletForm(nonce: string) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>스윔노트 오피스 · 신청 및 동의</title><style>
body{font:16px system-ui,sans-serif;background:#f3f5f4;color:#172c28;margin:0;padding:24px}main{max-width:720px;margin:auto;background:white;padding:24px;border-radius:12px}label{display:block;margin:16px 0}input,button{font:inherit;padding:12px;border:1px solid #a7b5af;border-radius:6px;box-sizing:border-box}input:not([type=checkbox]){width:100%}button{cursor:pointer;background:#244e42;color:white;margin:6px 6px 6px 0}canvas{width:100%;height:200px;border:1px solid #a7b5af;touch-action:none}pre{white-space:pre-wrap;line-height:1.6}#status{white-space:pre-wrap}button:disabled{opacity:.5}</style>
<main><h1>신청 및 직접 동의</h1><p>관리자 계정에 접근하지 않는 제한된 신청 화면입니다. 제출 후 센터가 확인합니다.</p>
<p id="version"></p><pre id="terms"></pre><form id="form" hidden>
<label>회원 이름<input name="name" maxlength="100" required autocomplete="off"></label>
<label>보호자/신청인 이름<input name="parentName" maxlength="100" required autocomplete="off"></label>
<label>연락처<input name="phone" maxlength="20" required type="tel" autocomplete="off"></label>
<pre id="consentText"></pre><label><input type="checkbox" name="consent" required> 위 내용을 확인하고 직접 동의합니다.</label>
<p>아래에 직접 서명하세요.</p><canvas id="signature" width="1000" height="300" aria-label="직접 서명 영역"></canvas>
<button type="button" id="clear">서명 지우기</button><button type="submit" id="submit">신청 제출</button></form><p role="status" id="status">신청 연결 확인 중…</p></main>
<script nonce="${nonce}">(()=>{
const token=location.hash.slice(1);history.replaceState(null,"",location.pathname);
const status=document.getElementById("status"),form=document.getElementById("form"),canvas=document.getElementById("signature"),ctx=canvas.getContext("2d");
let points=[],drawing=false,locked=false,body;const rid=crypto.randomUUID();
const api=location.pathname.replace(/\\/$/,"");
const headers={"Content-Type":"application/json","Authorization":"Bearer "+token};
function message(s){status.textContent=s}
async function call(path,options={}){const r=await fetch(api+path,{...options,headers,credentials:"omit",cache:"no-store"});const d=await r.json();if(!r.ok)throw Error(d.error||"연결 확인 실패");return d}
call("/form").then(d=>{document.getElementById("terms").textContent=d.template.body;document.getElementById("consentText").textContent=d.template.consentText;
document.getElementById("version").textContent=d.template.name+" · 양식 "+d.template.version;form.hidden=false;message("입력한 내용은 이 신청에만 사용됩니다. 관리자 확인 전 회원 등록이 아닙니다.")}).catch(e=>message(e.message));
canvas.addEventListener("pointerdown",e=>{if(locked)return;drawing=true;canvas.setPointerCapture(e.pointerId);add(e,true)});
canvas.addEventListener("pointermove",e=>{if(drawing&&!locked)add(e,false)});canvas.addEventListener("pointerup",()=>drawing=false);canvas.addEventListener("pointercancel",()=>drawing=false);
function add(e,start){if(points.length>=2500)return;const r=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
const last=points.at(-1);points.push([x,y,start?1:0]);if(last&&!start){ctx.beginPath();ctx.moveTo(last[0]*1000,last[1]*300);ctx.lineTo(x*1000,y*300);ctx.lineWidth=3;ctx.stroke()}}
document.getElementById("clear").onclick=()=>{if(!locked){points=[];ctx.clearRect(0,0,1000,300)}};
form.onsubmit=async e=>{e.preventDefault();if(locked)return;const d=new FormData(form);if(points.length<8)return message("빈 서명은 제출할 수 없습니다.");
body={requestId:rid,name:d.get("name"),parentName:d.get("parentName"),phone:d.get("phone"),consented:d.get("consent")==="on",signature:points};
locked=true;form.querySelectorAll("input,button").forEach(e=>e.disabled=true);message("제출 중…");
try{const r=await call("/submit",{method:"POST",body:JSON.stringify(body)});form.remove();message("접수되었습니다. 센터 확인을 기다려 주세요. 접수번호: "+r.applicationId)}
catch(e){message("제출 결과 확인이 필요합니다. 새로 제출하지 말고 센터에 확인해 주세요. "+e.message)}};
})();</script></html>`;
}
