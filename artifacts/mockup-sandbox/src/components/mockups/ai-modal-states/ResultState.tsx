/**
 * AI 모달 — RESULT 상태 (수정본)
 *
 * 검증 포인트:
 * 1. ✅ InputSummary: "입력 내용" 라벨 상단 + 텍스트+수정하기 아래줄
 * 2. ✅ AIInputArea 언마운트 → 빈 공간 없음
 * 3. ✅ 결과 카드 auto height (내용 길이에 맞게)
 * 4. ✅ ActionBar 하단 고정 유지
 */
export function ResultState() {
  const sampleResult = `오늘 수업에서 학생들의 자유형 호흡 동작을 집중적으로 연습했습니다.

전체적으로 팔 스트로크와 호흡 타이밍의 조화가 많이 개선되었으며, 특히 머리를 들지 않고 옆으로 돌려 호흡하는 기술이 향상되었습니다.

다음 수업에서는 킥 동작의 리듬감을 더욱 강화할 예정입니다.`;

  return (
    <div className="flex flex-col h-screen bg-white" style={{ maxWidth: 402, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* 모달 헤더 */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
        <span className="text-[17px] font-semibold text-gray-800">AI 일지 작성</span>
        <button className="text-[13px] font-medium text-gray-400">닫기</button>
      </div>

      {/* 콘텐츠 영역 — 스크롤 가능 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">

        {/* ① InputSummary — "입력 내용" 라벨 추가 */}
        <div className="bg-gray-50 rounded-xl px-3 pt-2 pb-2 flex flex-col gap-1">
          {/* 섹션 라벨 */}
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">입력 내용</span>
          {/* 텍스트 + 수정하기 */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-gray-700 flex-1 truncate">오늘 수업 자유형 호흡 연습했습니다</span>
            <button className="text-[13px] font-medium text-[#00B6A3] ml-2 shrink-0">수정하기</button>
          </div>
        </div>

        {/* ② AIInputArea 완전 언마운트 → 빈 공간 없음 */}

        {/* ③ 결과 카드 — auto height (flex:1 제거) */}
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-medium text-[#00B6A3]">AI 작성 결과</span>
          </div>
          {/* ScrollView 없이 Text 직접 렌더 — 외부 스크롤로 처리 */}
          <p className="text-[16px] text-gray-800 leading-relaxed whitespace-pre-wrap">{sampleResult}</p>
        </div>

        {/* 텍스트가 짧을 때의 예시 — 카드가 내용만큼만 크기를 가짐 */}
      </div>

      {/* ActionBar — 하단 고정 (변경 없음) */}
      <div className="border-t border-gray-100 px-4 pt-3 pb-6 bg-white">
        <div className="flex gap-2">
          <button className="flex-1 h-12 rounded-xl bg-gray-100 text-[15px] font-medium text-gray-600">다시 생성</button>
          <button className="flex-1 h-12 rounded-xl bg-[#00B6A3] text-[15px] font-semibold text-white">일지에 삽입</button>
        </div>
      </div>
    </div>
  );
}
