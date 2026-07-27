/**
 * 긴 AI 결과 — 스크롤 끝단 ActionBar 확인 (스크롤 맨 끝 상태 시뮬레이션)
 *
 * CSS translateY로 스크롤을 끝까지 내린 상태를 시뮬레이션
 * ActionBar가 화면 하단에 항상 보이는지 확인
 */
export function LongResultScrollTest() {
  // 긴 결과 + 스크롤 끝단만 보여주는 뷰
  const tailText = `...（이전 내용 생략）

다음 수업에서는 턴 동작 기초와 개인별 스트로크 효율 향상에 집중할 예정입니다.

[특이사항]
• 이OO 어깨 통증 호소 → 스트로크 강도 조절, 다음 수업 전 상태 재확인 필요
• 최OO 고글 불량으로 수업 중 교체, 보호자에게 고글 교체 안내 권장

[코치 메모]
오늘 수업 전반적으로 분위기가 좋았으며, 학생들의 집중도가 높았습니다. 특히 파트너 관찰 활동이 큰 효과를 발휘했습니다. 다음 수업에도 동료 피드백 활동을 유지할 예정입니다.`;

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

      {/* 스크롤 영역 — 이미 맨 끝까지 스크롤한 상태 시뮬레이션 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* InputSummary */}
        <div style={{ backgroundColor: "#f8fafc", borderRadius: 12, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5 }}>입력 내용</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>초급반 자유형 전체 점검</span>
            <button style={{ fontSize: 13, color: "#00B6A3", fontWeight: 500, background: "none", border: "none", cursor: "pointer", marginLeft: 8 }}>수정하기</button>
          </div>
        </div>

        {/* 결과 카드 끝부분만 표시 (스크롤 끝단 상태) */}
        <div style={{ borderRadius: 12, backgroundColor: "#f8fafc", border: "1px solid #e5e7eb", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#00B6A3" }}>AI 작성 결과</span>
          </div>
          <p style={{ fontSize: 14, color: "#1f2937", lineHeight: 1.75, whiteSpace: "pre-wrap", margin: 0, fontFamily: "monospace" }}>
            {tailText}
          </p>
        </div>

        {/* 스크롤 끝 도달 표시 */}
        <div style={{
          textAlign: "center",
          padding: "8px 12px",
          backgroundColor: "#f0fdf4",
          borderRadius: 8,
          color: "#16a34a",
          fontSize: 12,
          fontWeight: 500,
        }}>
          ✅ 스크롤 끝 도달 — 전체 내용 확인 완료
        </div>
      </div>

      {/* ActionBar — 스크롤 끝에서도 화면 하단에 정상적으로 고정 */}
      <div style={{ borderTop: "1px solid #f3f4f6", padding: "12px 16px 24px", backgroundColor: "#fff" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#f3f4f6", fontSize: 15, fontWeight: 500, color: "#4b5563", border: "none", cursor: "pointer" }}>다시 생성</button>
          <button style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#00B6A3", fontSize: 15, fontWeight: 600, color: "#fff", border: "none", cursor: "pointer" }}>일지에 삽입</button>
        </div>
      </div>
    </div>
  );
}
