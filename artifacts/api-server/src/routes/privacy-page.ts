import { Router } from "express";

const router = Router();

const SHARED_STYLE = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 15px; line-height: 1.8; color: #1a1a2e;
      background: #f8f9fb;
    }
    .header {
      background: #0a2540; color: #fff;
      padding: 40px 24px 32px; text-align: center;
    }
    .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 6px; }
    .header p { font-size: 14px; color: #a0b4c8; }
    .container { max-width: 780px; margin: 0 auto; padding: 40px 24px 80px; }
    .card {
      background: #fff; border-radius: 16px; padding: 32px;
      margin-bottom: 20px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
    }
    h2 {
      font-size: 17px; font-weight: 700; color: #0a2540;
      margin-bottom: 16px; padding-bottom: 10px;
      border-bottom: 2px solid #e8f0fe;
    }
    h3 { font-size: 15px; font-weight: 600; color: #1a3a5c; margin: 20px 0 8px; }
    p { margin-bottom: 12px; color: #3d4f66; }
    ul { padding-left: 20px; margin-bottom: 12px; color: #3d4f66; }
    li { margin-bottom: 6px; }
    a { color: #1A5CFF; text-decoration: none; }
    .highlight {
      background: #eef3ff; border-left: 4px solid #1A5CFF;
      border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 16px 0;
      font-size: 14px; color: #1a3a5c;
    }
    .footer { text-align: center; color: #8a9ab0; font-size: 13px; margin-top: 40px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    th { background: #f0f5ff; color: #0a2540; font-weight: 600; padding: 10px 12px; text-align: left; border: 1px solid #d8e4f0; }
    td { padding: 10px 12px; border: 1px solid #e8eef5; color: #3d4f66; vertical-align: top; }
    @media (max-width: 600px) {
      .card { padding: 20px 16px; }
      .header { padding: 28px 16px 24px; }
      .header h1 { font-size: 20px; }
      table { font-size: 13px; }
      th, td { padding: 8px; }
    }
  </style>
`;

// ──────────────────────────────────────────────
// 이용약관
// ──────────────────────────────────────────────
const TERMS_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>이용약관 — 스윔노트</title>
  ${SHARED_STYLE}
</head>
<body>

<div class="header">
  <h1>이용약관</h1>
  <p>스윔노트 (SwimNote) · 시행일: 2026년 4월 6일</p>
</div>

<div class="container">

  <div class="card">
    <h2>제1조 (목적)</h2>
    <p>이 약관은 스윔노트(이하 "회사")가 제공하는 모바일 애플리케이션 및 관련 서비스(이하 "서비스")의 이용에 관한 조건 및 절차, 회사와 이용자의 권리·의무 및 책임사항, 기타 필요한 사항을 규정함을 목적으로 합니다.</p>
  </div>

  <div class="card">
    <h2>제2조 (서비스 설명)</h2>
    <p>스윔노트는 어린이 수영장 운영을 위한 통합 관리 플랫폼으로, 수영장 운영자·선생님·학부모를 연결합니다.</p>
    <ul>
      <li>수강생 회원 관리 및 출결 처리</li>
      <li>수업 일지 작성 및 학부모 공유</li>
      <li>선생님·학부모 간 메시지 교환</li>
      <li>사진·영상 업로드 및 공유</li>
      <li>보강 관리, 공지사항, 푸시 알림</li>
      <li>수강료 정산 및 구독 관리</li>
    </ul>
    <div class="highlight">서비스는 수영장 관리자, 선생님, 학부모 세 가지 역할로 구분되며, 각 역할에 따라 접근 가능한 기능이 다릅니다.</div>
  </div>

  <div class="card">
    <h2>제3조 (계정 및 회원가입)</h2>
    <h3>1. 회원가입</h3>
    <p>서비스를 이용하기 위해서는 계정을 생성해야 합니다. 회원가입 시 정확하고 최신의 정보를 제공해야 합니다. 허위 정보 입력 시 이용이 제한될 수 있습니다.</p>
    <h3>2. 계정 책임</h3>
    <p>이용자는 자신의 계정 정보(아이디, 비밀번호 등)를 안전하게 관리할 책임이 있으며, 계정 정보가 제3자에 의해 무단 사용될 경우 즉시 회사에 통보해야 합니다.</p>
    <h3>3. 학부모 계정</h3>
    <p>학부모 계정은 수영장 관리자의 승인 후 서비스 이용이 가능합니다. 자녀 정보는 정확하게 입력해야 하며, 변경 시 즉시 수정해야 합니다.</p>
  </div>

  <div class="card">
    <h2>제4조 (서비스 이용 제한)</h2>
    <p>다음 행위는 금지됩니다.</p>
    <ul>
      <li>타인의 정보 도용 및 사칭</li>
      <li>서비스의 정상적인 운영을 방해하는 행위</li>
      <li>악의적인 데이터 조작 또는 시스템 해킹 시도</li>
      <li>타인의 동의 없는 개인정보 수집·공유</li>
      <li>상업적 광고 또는 스팸 전송</li>
      <li>관련 법령을 위반하는 행위</li>
    </ul>
    <div class="highlight">위 사항을 위반할 경우 사전 통보 없이 계정이 정지 또는 삭제될 수 있습니다.</div>
  </div>

  <div class="card">
    <h2>제5조 (데이터 및 콘텐츠)</h2>
    <h3>1. 데이터 범위</h3>
    <p>서비스 이용 과정에서 수업 정보, 출결 기록, 학생 정보, 사진, 영상, 메시지 등의 데이터가 저장됩니다.</p>
    <h3>2. 데이터 소유</h3>
    <p>이용자가 업로드한 콘텐츠(사진, 영상 등)의 소유권은 이용자에게 있습니다. 단, 회사는 서비스 제공을 위해 해당 콘텐츠를 처리·저장할 수 있습니다.</p>
    <h3>3. 데이터 관리 책임</h3>
    <p>수강생 정보 및 수업 데이터의 관리 책임은 각 수영장 운영자에게 있습니다. 회사는 데이터의 무단 유출 방지를 위해 기술적 조치를 취하지만, 운영자의 관리 소홀로 인한 문제에 대해서는 책임을 지지 않습니다.</p>
  </div>

  <div class="card">
    <h2>제6조 (서비스 변경 및 중단)</h2>
    <p>회사는 서비스의 내용, 운영 상 필요에 따라 서비스의 전부 또는 일부를 수정, 변경, 중단할 수 있습니다.</p>
    <ul>
      <li>서비스 변경·중단 시 사전 고지를 원칙으로 합니다.</li>
      <li>불가피한 사유(시스템 장애, 천재지변 등)로 인한 경우 사전 고지가 어려울 수 있습니다.</li>
      <li>서비스 중단 시 이용자의 데이터는 관련 법령에 따라 처리됩니다.</li>
    </ul>
  </div>

  <div class="card">
    <h2>제7조 (구독 및 결제)</h2>
    <p>수영장 운영자는 서비스 이용을 위해 월정액 구독 상품에 가입해야 합니다.</p>
    <ul>
      <li>구독 요금은 App Store 및 Google Play 정책에 따라 결제됩니다.</li>
      <li>구독 취소는 각 스토어의 구독 관리 화면에서 가능합니다.</li>
      <li>환불 정책은 Apple App Store 및 Google Play의 환불 정책을 따릅니다.</li>
    </ul>
  </div>

  <div class="card">
    <h2>제8조 (책임 제한)</h2>
    <p>회사는 다음과 같은 경우 발생한 손해에 대해 책임을 지지 않습니다.</p>
    <ul>
      <li>천재지변, 전쟁, 기간통신사업자의 서비스 중단 등 불가항력</li>
      <li>이용자의 귀책사유로 인한 서비스 이용 장애</li>
      <li>이용자가 서비스 내에 게시한 정보, 자료의 신뢰성·정확성</li>
      <li>수업 내용 및 교육 품질 — 이는 각 수영장 운영자의 책임입니다</li>
    </ul>
  </div>

  <div class="card">
    <h2>제9조 (준거법 및 관할법원)</h2>
    <p>이 약관은 대한민국 법률에 따라 규율되며, 서비스 이용과 관련한 분쟁은 대한민국 법원을 관할 법원으로 합니다.</p>
  </div>

  <div class="card">
    <h2>제10조 (문의)</h2>
    <p>서비스 이용약관에 관한 문의는 아래로 연락해 주세요.</p>
    <table>
      <tr><th>구분</th><th>내용</th></tr>
      <tr><td>서비스명</td><td>스윔노트 (SwimNote)</td></tr>
      <tr><td>이메일</td><td>support@swimnote.app</td></tr>
      <tr><td>처리 시간</td><td>영업일 기준 2일 이내 회신</td></tr>
    </table>
    <div class="highlight">본 약관은 2026년 4월 6일부터 시행됩니다.</div>
  </div>

  <div class="footer">
    <p>스윔노트 (SwimNote) · support@swimnote.app</p>
    <p style="margin-top:8px;">ⓒ 2026 SwimNote. All rights reserved.</p>
  </div>

</div>
</body>
</html>`;

// ──────────────────────────────────────────────
// 개인정보처리방침
// ──────────────────────────────────────────────
const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>개인정보처리방침 — 스윔노트</title>
  ${SHARED_STYLE}
</head>
<body>

<div class="header">
  <h1>개인정보처리방침</h1>
  <p>스윔노트 (SwimNote) · 시행일: 2026년 4월 6일</p>
</div>

<div class="container">

  <div class="card">
    <h2>제1조 (수집하는 개인정보 항목)</h2>
    <table>
      <tr>
        <th>구분</th><th>수집 항목</th><th>수집 방법</th>
      </tr>
      <tr>
        <td>수영장 관리자</td>
        <td>이름, 이메일, 휴대전화번호, 수영장 상호명</td>
        <td>회원가입 시</td>
      </tr>
      <tr>
        <td>선생님</td>
        <td>이름, 이메일, 휴대전화번호</td>
        <td>회원가입·초대 시</td>
      </tr>
      <tr>
        <td>학부모·수강생</td>
        <td>이름, 휴대전화번호, 자녀 정보(이름·생년월일), 수강 정보, 출결 기록</td>
        <td>회원가입 시</td>
      </tr>
      <tr>
        <td>수업 관련</td>
        <td>수업 일지, 사진, 영상, 선생님 피드백</td>
        <td>서비스 이용 시</td>
      </tr>
      <tr>
        <td>자동 수집</td>
        <td>앱 접속 기록, 기기 식별자(알림 토큰), OS 버전, 앱 버전</td>
        <td>서비스 이용 시</td>
      </tr>
    </table>
    <div class="highlight">만 14세 미만 아동의 개인정보는 법정대리인(학부모)의 동의를 받아 처리합니다.</div>
  </div>

  <div class="card">
    <h2>제2조 (개인정보의 수집 목적)</h2>
    <ul>
      <li><strong>회원 관리:</strong> 회원 식별, 서비스 이용 자격 확인, 계정 보안</li>
      <li><strong>수업 운영:</strong> 출결 처리, 수강생 관리, 반 배정</li>
      <li><strong>학부모 피드백 제공:</strong> 수업 일지 공유, 선생님·학부모 메시지 교환</li>
      <li><strong>알림 서비스:</strong> 출결·공지·수업 관련 푸시 알림 발송</li>
      <li><strong>서비스 개선:</strong> 오류 분석, 기능 개선</li>
    </ul>
  </div>

  <div class="card">
    <h2>제3조 (개인정보의 보관 기간)</h2>
    <ul>
      <li><strong>회원 정보:</strong> 서비스 이용 기간 동안 보관 / 탈퇴 후 30일 이내 파기</li>
      <li><strong>수업·출결 기록:</strong> 서비스 이용 종료 후 1년</li>
      <li><strong>사진·영상:</strong> 업로드 후 서비스 내 보관, 삭제 요청 시 즉시 파기</li>
      <li><strong>결제 관련 기록:</strong> 5년 (전자상거래법)</li>
      <li><strong>접속 기록:</strong> 3개월 (통신비밀보호법)</li>
    </ul>
    <div class="highlight">탈퇴 신청 후 3개월 이내 재가입 시 기존 데이터 복구가 가능하며, 3개월 경과 후에는 완전 삭제됩니다.</div>
  </div>

  <div class="card">
    <h2>제4조 (개인정보의 제3자 제공)</h2>
    <p>회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우는 예외입니다.</p>
    <ul>
      <li>이용자가 사전에 동의한 경우</li>
      <li>법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차에 따라 수사기관이 요구한 경우</li>
    </ul>
  </div>

  <div class="card">
    <h2>제5조 (개인정보 처리의 위탁)</h2>
    <table>
      <tr><th>수탁업체</th><th>위탁 업무</th></tr>
      <tr><td>Cloudflare (Cloudflare, Inc.)</td><td>사진·영상 파일 저장 (R2 Object Storage)</td></tr>
      <tr><td>Firebase (Google LLC)</td><td>푸시 알림 발송</td></tr>
      <tr><td>RevenueCat, Inc.</td><td>구독 결제 처리 및 관리</td></tr>
    </table>
    <p>각 수탁업체는 위탁받은 업무 이외의 목적으로 개인정보를 사용하지 않습니다.</p>
  </div>

  <div class="card">
    <h2>제6조 (이용자의 권리)</h2>
    <p>이용자는 언제든지 다음과 같은 권리를 행사할 수 있습니다.</p>
    <ul>
      <li>개인정보 열람 요청</li>
      <li>오류 정정 요청</li>
      <li>삭제(탈퇴) 요청</li>
      <li>개인정보 처리 정지 요청</li>
    </ul>
    <div class="highlight">앱 내 [설정 → 내 정보 → 회원 탈퇴] 메뉴에서 직접 탈퇴하거나, 이메일(privacy@swimnote.app)로 요청할 수 있습니다. 영업일 기준 2일 이내 처리됩니다.</div>
  </div>

  <div class="card">
    <h2>제7조 (개인정보의 파기)</h2>
    <h3>파기 사유</h3>
    <p>보유 기간 경과, 처리 목적 달성, 이용자의 삭제 요청 시 지체 없이 파기합니다.</p>
    <h3>파기 방법</h3>
    <p>전자적 파일 형태의 정보는 복구 불가능한 기술적 방법으로 삭제하며, 데이터베이스에서 완전히 제거합니다.</p>
  </div>

  <div class="card">
    <h2>제8조 (개인정보의 보안)</h2>
    <p>회사는 개인정보 보호를 위해 다음과 같은 조치를 취합니다.</p>
    <ul>
      <li>비밀번호 bcrypt 암호화 저장</li>
      <li>모든 데이터 전송 시 TLS(HTTPS) 암호화</li>
      <li>JWT 기반 인증 및 접근 권한 관리</li>
      <li>파일 저장소(Cloudflare R2) 서명된 URL을 통한 접근 제어</li>
      <li>정기적인 보안 점검</li>
    </ul>
  </div>

  <div class="card">
    <h2>제9조 (개인정보 보호책임자 및 문의)</h2>
    <table>
      <tr><th>구분</th><th>내용</th></tr>
      <tr><td>책임자</td><td>스윔노트 운영팀</td></tr>
      <tr><td>이메일</td><td>privacy@swimnote.app</td></tr>
      <tr><td>처리 시간</td><td>영업일 기준 2일 이내</td></tr>
    </table>
    <p style="margin-top:16px;">개인정보 관련 불만·신고는 아래 기관에 문의하실 수 있습니다.</p>
    <ul>
      <li>개인정보분쟁조정위원회: <a href="https://www.kopico.go.kr">www.kopico.go.kr</a> (☎ 1833-6972)</li>
      <li>개인정보침해신고센터: <a href="https://privacy.kisa.or.kr">privacy.kisa.or.kr</a> (☎ 118)</li>
      <li>대검찰청: <a href="https://www.spo.go.kr">www.spo.go.kr</a> (☎ 1301)</li>
      <li>경찰청: <a href="https://ecrm.cyber.go.kr">ecrm.cyber.go.kr</a> (☎ 182)</li>
    </ul>
  </div>

  <div class="card">
    <h2>제10조 (방침의 변경)</h2>
    <p>본 개인정보처리방침은 2026년 4월 6일부터 시행됩니다. 방침 변경 시 앱 내 공지사항을 통해 고지합니다.</p>
    <ul>
      <li>2026년 4월 6일 — 최초 시행</li>
    </ul>
  </div>

  <div class="footer">
    <p>스윔노트 (SwimNote) · privacy@swimnote.app</p>
    <p style="margin-top:8px;">본 방침은 「개인정보 보호법」을 준수합니다.</p>
  </div>

</div>
</body>
</html>`;

router.get("/terms", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(TERMS_HTML);
});

router.get("/privacy-policy", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(PRIVACY_HTML);
});

export default router;
