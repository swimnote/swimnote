/**
 * AI 모달 — ERROR 상태 미리보기
 * DiaryAIContent: state='ERROR' → AIErrorView 렌더링
 */
export function ErrorState() {
  return (
    <div className="flex flex-col h-screen bg-white" style={{ maxWidth: 402, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* 모달 헤더 */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
        <span className="text-[17px] font-semibold text-gray-800">AI 일지 작성</span>
        <button className="text-[13px] font-medium text-gray-400">닫기</button>
      </div>

      {/* 콘텐츠 영역 — AIErrorView */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
          <span className="text-2xl">⚠️</span>
        </div>
        <div className="text-center">
          <p className="text-[17px] font-semibold text-gray-800 mb-1">일지 작성에 실패했습니다</p>
          <p className="text-[13px] text-gray-500">네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
        </div>
        <button className="h-12 px-6 rounded-xl bg-[#00B6A3] text-[15px] font-semibold text-white">
          닫기
        </button>
      </div>

      {/* ActionBar — ERROR 상태에서도 하단 고정 */}
      <div className="border-t border-gray-100 px-4 pt-3 pb-6 bg-white">
        <div className="flex gap-2">
          <button className="flex-1 h-12 rounded-xl bg-gray-100 text-[15px] font-medium text-gray-400">취소</button>
          <button className="flex-1 h-12 rounded-xl bg-gray-200 text-[15px] font-semibold text-gray-400" disabled>AI 작성</button>
        </div>
      </div>
    </div>
  );
}
