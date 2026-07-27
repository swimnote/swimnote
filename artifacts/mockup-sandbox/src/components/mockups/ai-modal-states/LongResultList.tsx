/**
 * 긴 AI 결과 — 리스트 형식 (줄바꿈 많음, ~2000자)
 *
 * 검증 포인트:
 * 1. 리스트 항목들이 줄바꿈과 함께 card 안에서 자연스럽게 늘어나는가
 * 2. 외부 ScrollView 단독 스크롤 동작
 * 3. ActionBar 하단 고정
 */
export function LongResultList() {
  const listResult = `[오늘 수업 요약]
일시: 2026년 7월 27일 (일)
대상: 초급반 6명
주제: 자유형 전체 동작 점검

[킥 동작]
• 문제: 무릎 과굴곡으로 추진력 감소
• 교정: 허벅지~발끝 일직선 유지 반복 강조
• 주요 대상: 박OO (킥 리듬 불규칙 → 비트판 집중 훈련)
• 결과: 수업 후반 현저한 개선 확인

[팔 스트로크]
• 문제: 입수 각도 납작 → 추진력 손실
• 교정: 엄지 먼저 입수, 45도 각도 유지
• 주요 대상: 김OO (팔꿈치 처짐 → High Elbow Recovery 지도)
• 결과: 입수 각도 전반 개선

[호흡 타이밍]
• 문제: 머리를 들어올리며 호흡 → 자세 무너짐
• 교정: 팔 전진 시 옆으로 돌려 흡기, 느린 시연 + 파트너 관찰
• 주요 대상: 이OO, 최OO (관찰 활동 후 타이밍 안정)
• 결과: 전원 호흡 패턴 안정화 진행 중

[완주 테스트]
• 25m 자유형 × 2회
• 정OO: 첫 무정지 완주 달성 🎉
• 전원 수업 초반 대비 자세 안정도 향상

[다음 수업 계획]
• 턴 동작 기초 (벽 터치 → 푸시오프)
• 개인별 스트로크 효율 분석
• 박OO 킥 리듬 추가 훈련
• 김OO 리커버리 동영상 피드백 제공

[특이사항]
• 이OO 어깨 통증 호소 → 스트로크 강도 조절, 다음 수업 전 상태 재확인 필요
• 최OO 고글 불량으로 수업 중 교체, 보호자에게 고글 교체 안내 권장`;

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

      {/* 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* InputSummary */}
        <div style={{ backgroundColor: "#f8fafc", borderRadius: 12, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>입력 내용</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>초급반 자유형 킥 스트로크 호흡 점검 요약 정리</span>
            <button style={{ fontSize: 13, color: "#00B6A3", fontWeight: 500, background: "none", border: "none", cursor: "pointer", marginLeft: 8 }}>수정하기</button>
          </div>
        </div>

        {/* 결과 카드 — 리스트 형식, auto height */}
        <div style={{ borderRadius: 12, backgroundColor: "#f8fafc", border: "1px solid #e5e7eb", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#00B6A3" }}>AI 작성 결과</span>
          </div>
          <p style={{ fontSize: 14, color: "#1f2937", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace" }}>
            {listResult}
          </p>
        </div>

        <div style={{ textAlign: "center", padding: "4px 0", color: "#9ca3af", fontSize: 11 }}>↑ 스크롤 끝</div>
      </div>

      {/* ActionBar */}
      <div style={{ borderTop: "1px solid #f3f4f6", padding: "12px 16px 24px", backgroundColor: "#fff" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#f3f4f6", fontSize: 15, fontWeight: 500, color: "#4b5563", border: "none", cursor: "pointer" }}>다시 생성</button>
          <button style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#00B6A3", fontSize: 15, fontWeight: 600, color: "#fff", border: "none", cursor: "pointer" }}>일지에 삽입</button>
        </div>
      </div>
    </div>
  );
}
