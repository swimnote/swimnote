import { Router } from "express";

const router = Router();

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>개인정보처리방침 — 스윔노트</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 15px; line-height: 1.8; color: #1a1a2e;
      background: #f8f9fb; padding: 0;
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
    .highlight {
      background: #eef3ff; border-left: 4px solid #1A5CFF;
      border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 16px 0;
      font-size: 14px; color: #1a3a5c;
    }
    .footer { text-align: center; color: #8a9ab0; font-size: 13px; margin-top: 40px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    th { background: #f0f5ff; color: #0a2540; font-weight: 600; padding: 10px 12px; text-align: left; border: 1px solid #d8e4f0; }
    td { padding: 10px 12px; border: 1px solid #e8eef5; color: #3d4f66; vertical-align: top; }
  </style>
</head>
<body>

<div class="header">
  <h1>개인정보처리방침</h1>
  <p>스윔노트 (SwimNote) · 최종 수정일: 2025년 1월 1일</p>
</div>

<div class="container">

  <div class="card">
    <h2>제1조 (개인정보의 처리 목적)</h2>
    <p>스윔노트(이하 "회사")는 다음 목적을 위해 개인정보를 처리합니다. 처리한 개인정보는 다음의 목적 이외의 용도로는 사용되지 않으며, 목적이 변경될 경우 「개인정보 보호법」 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행합니다.</p>
    <ul>
      <li>수영장 관리 서비스 제공 및 회원 관리</li>
      <li>수업 출결 관리, 수강생 정보 관리</li>
      <li>선생님·학부모 연결 및 알림 서비스 제공</li>
      <li>고객 문의 처리 및 민원 대응</li>
      <li>서비스 개선 및 신규 서비스 개발</li>
    </ul>
  </div>

  <div class="card">
    <h2>제2조 (수집하는 개인정보 항목)</h2>
    <table>
      <tr>
        <th>구분</th><th>수집 항목</th><th>수집 방법</th>
      </tr>
      <tr>
        <td>수영장 관리자</td>
        <td>이름, 이메일, 비밀번호, 휴대전화번호, 수영장 상호명, 사업자 정보</td>
        <td>회원가입 시</td>
      </tr>
      <tr>
        <td>선생님</td>
        <td>이름, 이메일, 휴대전화번호, 수업 정보</td>
        <td>회원가입·초대 시</td>
      </tr>
      <tr>
        <td>학부모·수강생</td>
        <td>이름, 휴대전화번호, 자녀 정보(이름·생년월일·성별), 수강 정보</td>
        <td>회원가입 시</td>
      </tr>
      <tr>
        <td>자동 수집</td>
        <td>앱 접속 기록, 기기 식별자(광고 ID), OS 버전, 앱 버전</td>
        <td>서비스 이용 시</td>
      </tr>
    </table>
    <div class="highlight">만 14세 미만 아동의 개인정보는 법정대리인(학부모)의 동의를 받아 처리합니다.</div>
  </div>

  <div class="card">
    <h2>제3조 (개인정보의 처리 및 보유 기간)</h2>
    <p>회사는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 개인정보를 수집 시에 동의받은 보유·이용 기간 내에서 개인정보를 처리·보유합니다.</p>
    <ul>
      <li><strong>회원 정보:</strong> 회원 탈퇴 시까지 (탈퇴 후 30일 이내 파기)</li>
      <li><strong>수업·출결 기록:</strong> 서비스 이용 종료 후 1년</li>
      <li><strong>전자상거래 관련 기록:</strong> 5년 (전자상거래법)</li>
      <li><strong>소비자 불만·분쟁 기록:</strong> 3년 (전자상거래법)</li>
      <li><strong>접속 기록:</strong> 3개월 (통신비밀보호법)</li>
    </ul>
  </div>

  <div class="card">
    <h2>제4조 (개인정보의 제3자 제공)</h2>
    <p>회사는 원칙적으로 정보주체의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우는 예외로 합니다.</p>
    <ul>
      <li>정보주체가 사전에 동의한 경우</li>
      <li>법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
    </ul>
  </div>

  <div class="card">
    <h2>제5조 (개인정보 처리의 위탁)</h2>
    <table>
      <tr>
        <th>수탁업체</th><th>위탁 업무</th>
      </tr>
      <tr>
        <td>Amazon Web Services (AWS)</td>
        <td>서버 인프라 및 데이터 보관</td>
      </tr>
      <tr>
        <td>Firebase (Google LLC)</td>
        <td>푸시 알림 발송</td>
      </tr>
    </table>
  </div>

  <div class="card">
    <h2>제6조 (정보주체의 권리·의무 및 행사 방법)</h2>
    <p>정보주체는 회사에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수 있습니다.</p>
    <ul>
      <li>개인정보 열람 요구</li>
      <li>오류 등이 있을 경우 정정 요구</li>
      <li>삭제 요구</li>
      <li>처리 정지 요구</li>
    </ul>
    <div class="highlight">권리 행사는 앱 내 [설정 → 문의하기] 메뉴 또는 아래 연락처를 통해 가능합니다.</div>
  </div>

  <div class="card">
    <h2>제7조 (개인정보의 파기)</h2>
    <p>회사는 개인정보 보유 기간의 경과, 처리 목적 달성 등으로 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.</p>
    <h3>파기 절차</h3>
    <p>불필요한 개인정보는 개인정보 책임자의 방침에 따라 개인정보보호 담당자가 파기합니다.</p>
    <h3>파기 방법</h3>
    <p>전자적 파일 형태의 정보는 기록을 재생할 수 없는 기술적 방법을 사용하며, 종이에 출력된 개인정보는 분쇄기로 분쇄하거나 소각합니다.</p>
  </div>

  <div class="card">
    <h2>제8조 (개인정보의 안전성 확보 조치)</h2>
    <p>회사는 개인정보보호법 제29조에 따라 다음과 같이 안전성 확보에 필요한 기술적·관리적·물리적 조치를 하고 있습니다.</p>
    <ul>
      <li>개인정보 취급 직원 최소화 및 교육</li>
      <li>내부 관리 계획 수립·시행</li>
      <li>해킹 등에 대비한 기술적 대책 (보안 프로그램 설치, 주기적 갱신)</li>
      <li>개인정보의 암호화 (비밀번호 bcrypt 암호화, 전송 데이터 TLS 암호화)</li>
      <li>접속 기록 보관 및 위변조 방지</li>
    </ul>
  </div>

  <div class="card">
    <h2>제9조 (개인정보 보호책임자)</h2>
    <p>회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 정보주체의 개인정보 관련 불만 처리 및 피해 구제 등을 위해 아래와 같이 개인정보 보호책임자를 지정합니다.</p>
    <table>
      <tr>
        <th>구분</th><th>내용</th>
      </tr>
      <tr>
        <td>책임자 성명</td><td>스윔노트 운영팀</td>
      </tr>
      <tr>
        <td>이메일</td><td>privacy@swimnote.app</td>
      </tr>
      <tr>
        <td>처리 시간</td><td>영업일 기준 2일 이내 회신</td>
      </tr>
    </table>
    <p>정보주체는 개인정보보호법 제55조의 규정에 의한 권익침해 모든 신고, 상담은 아래의 기관에 문의하실 수 있습니다.</p>
    <ul>
      <li>개인정보분쟁조정위원회: <a href="https://www.kopico.go.kr">www.kopico.go.kr</a> (국번없이 1833-6972)</li>
      <li>개인정보침해신고센터: <a href="https://privacy.kisa.or.kr">privacy.kisa.or.kr</a> (국번없이 118)</li>
      <li>대검찰청: <a href="https://www.spo.go.kr">www.spo.go.kr</a> (국번없이 1301)</li>
      <li>경찰청: <a href="https://ecrm.cyber.go.kr">ecrm.cyber.go.kr</a> (국번없이 182)</li>
    </ul>
  </div>

  <div class="card">
    <h2>제10조 (개인정보처리방침의 변경)</h2>
    <p>이 개인정보처리방침은 2025년 1월 1일부터 적용됩니다. 이전의 개인정보처리방침은 아래에서 확인할 수 있습니다.</p>
    <ul>
      <li>2025년 1월 1일 — 최초 시행</li>
    </ul>
  </div>

  <div class="footer">
    <p>스윔노트 (SwimNote) · privacy@swimnote.app</p>
    <p style="margin-top:8px;">본 방침은 「개인정보 보호법」을 준수합니다.</p>
  </div>

</div>
</body>
</html>`;

router.get("/privacy-policy", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(PRIVACY_HTML);
});

export default router;
