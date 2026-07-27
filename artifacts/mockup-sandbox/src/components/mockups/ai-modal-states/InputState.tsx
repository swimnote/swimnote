/**
 * AI 모달 — INPUT 상태 미리보기
 * DiaryAIContent: showInput=true, showSummary=false, showResult=false
 */
export function InputState() {
  return (
    <div className="flex flex-col h-screen bg-white" style={{ maxWidth: 402, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* 모달 헤더 */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
        <span className="text-[17px] font-semibold text-gray-800">AI 일지 작성</span>
        <button className="text-[13px] font-medium text-gray-400">닫기</button>
      </div>

      {/* 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">

        {/* ✅ INPUT 상태: AIInputArea 렌더링됨 */}
        {/* InputSummary 없음 */}

        {/* TextInput */}
        <div className="min-h-[120px] rounded-xl bg-gray-50 border border-gray-200 p-3">
          <p className="text-[17px] text-gray-300">수업 내용을 간단히 입력하거나 음성으로 말씀하세요</p>
        </div>

        {/* 음성 버튼 */}
        <div className="h-14 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center gap-2">
          <span className="text-[20px]">🎤</span>
          <span className="text-[13px] font-medium text-gray-500">음성</span>
        </div>

        {/* ✅ 결과 카드 없음 — 빈 공간도 없어야 함 */}
        <div className="flex-1" />
      </div>

      {/* ActionBar */}
      <div className="border-t border-gray-100 px-4 pt-3 pb-6 bg-white">
        <div className="flex gap-2">
          <button className="flex-1 h-12 rounded-xl bg-gray-100 text-[15px] font-medium text-gray-500">취소</button>
          <button className="flex-1 h-12 rounded-xl bg-[#00B6A3] text-[15px] font-semibold text-white">AI 작성</button>
        </div>
      </div>
    </div>
  );
}
