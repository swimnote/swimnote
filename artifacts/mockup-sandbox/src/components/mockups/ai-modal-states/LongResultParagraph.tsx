/**
 * 긴 AI 결과 — 긴 문단 형식 (~2000자)
 *
 * 검증 포인트:
 * 1. 결과 카드가 내용 길이에 맞게 자연스럽게 늘어나는가
 * 2. 외부 ScrollView 하나만으로 끝까지 스크롤 가능한가
 * 3. ActionBar가 스크롤 끝에서 화면 하단에 정상적으로 붙어 있는가
 */
export function LongResultParagraph() {
  const longParagraphResult = `오늘 수업은 초급반 6명을 대상으로 자유형 기초 동작 전체를 점검하는 시간이었습니다. 수업 시작 전 준비 운동으로 어깨 돌리기, 팔 스트레칭, 발목 유연성 운동을 충분히 진행하였으며, 물에 들어가기 전 호흡 패턴을 육상에서 먼저 연습하였습니다.

킥 동작의 경우, 대부분의 학생들이 무릎을 지나치게 구부리는 경향이 있어 허벅지부터 발끝까지 일직선을 유지하는 킥 형태를 반복적으로 교정하였습니다. 특히 박OO 학생의 경우 킥 리듬이 불규칙하여 비트판을 잡고 킥만 집중적으로 연습하는 시간을 추가로 부여하였으며, 수업 후반부에는 눈에 띄는 개선을 보여주었습니다.

팔 스트로크 동작에서는 입수 각도 교정이 주된 과제였습니다. 손이 수면에 너무 납작하게 들어가는 학생들이 다수였는데, 이는 추진력 손실로 직결되므로 엄지손가락이 먼저 입수하는 자세를 반복 강조하였습니다. 김OO 학생은 스트로크 리커버리 시 팔꿈치가 처지는 문제가 있어 High Elbow Recovery 동작을 별도로 지도하였습니다.

호흡 타이밍은 이번 수업에서 가장 많은 시간을 할애한 부분입니다. 팔이 앞으로 뻗는 순간 머리를 돌려 호흡하는 패턴을 인식시키기 위해 느린 속도로 반복 시연하고, 학생들이 직접 파트너 관찰을 통해 서로의 호흡 타이밍을 피드백하는 활동을 진행하였습니다. 이OO 학생과 최OO 학생 모두 이 활동 이후 호흡 타이밍이 상당히 안정되는 모습을 보였습니다.

전체 수업 마무리는 25m 자유형 2회 완주로 진행하였습니다. 수업 초반 대비 대부분의 학생들이 훨씬 안정적인 자세를 유지하며 완주하였으며, 특히 정OO 학생은 처음으로 멈추지 않고 25m를 완주하는 성취를 이루었습니다. 다음 수업에서는 턴 동작 기초와 개인별 스트로크 효율 향상에 집중할 예정입니다.`;

  return (
    <div
      style={{
        maxWidth: 402,
        height: 874,
        margin: "0 auto",
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#fff",
        border: "1px solid #e5e7eb",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 12px", borderBottom: "1px solid #f3f4f6" }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: "#1f2937" }}>AI 일지 작성</span>
        <button style={{ fontSize: 13, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>닫기</button>
      </div>

      {/* 스크롤 영역 — 외부 ScrollView 단독 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* InputSummary */}
        <div style={{ backgroundColor: "#f8fafc", borderRadius: 12, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>입력 내용</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>초급반 자유형 킥·스트로크·호흡 전체 점검 수업</span>
            <button style={{ fontSize: 13, color: "#00B6A3", fontWeight: 500, background: "none", border: "none", cursor: "pointer", marginLeft: 8 }}>수정하기</button>
          </div>
        </div>

        {/* 결과 카드 — auto height, 내용 길이에 맞게 늘어남 */}
        <div style={{ borderRadius: 12, backgroundColor: "#f8fafc", border: "1px solid #e5e7eb", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#00B6A3" }}>AI 작성 결과</span>
          </div>
          {/* Text 직접 렌더 — 내부 ScrollView 없음 */}
          <p style={{ fontSize: 15, color: "#1f2937", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>
            {longParagraphResult}
          </p>
        </div>

        {/* 스크롤 끝 확인용 마커 */}
        <div style={{ textAlign: "center", padding: "4px 0", color: "#9ca3af", fontSize: 11 }}>↑ 스크롤 끝 (ActionBar는 화면 하단 고정)</div>
      </div>

      {/* ActionBar — 하단 고정 */}
      <div style={{ borderTop: "1px solid #f3f4f6", padding: "12px 16px 24px", backgroundColor: "#fff" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#f3f4f6", fontSize: 15, fontWeight: 500, color: "#4b5563", border: "none", cursor: "pointer" }}>다시 생성</button>
          <button style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#00B6A3", fontSize: 15, fontWeight: 600, color: "#fff", border: "none", cursor: "pointer" }}>일지에 삽입</button>
        </div>
      </div>
    </div>
  );
}
