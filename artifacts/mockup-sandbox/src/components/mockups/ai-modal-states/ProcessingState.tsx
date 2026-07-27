/**
 * AI 모달 — PROCESSING 상태 미리보기
 * DiaryAIContent: showLoading=true → AILoading 렌더링
 * INPUT/RESULT 모두 숨겨짐
 */
export function ProcessingState() {
  return (
    <div className="flex flex-col h-screen bg-white" style={{ maxWidth: 402, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* 모달 헤더 */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
        <span className="text-[17px] font-semibold text-gray-800">AI 일지 작성</span>
        <button className="text-[13px] font-medium text-gray-400">닫기</button>
      </div>

      {/* 콘텐츠 영역 — AILoading 컴포넌트 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4">
        <div className="flex gap-2 items-end h-8">
          {[0.4, 0.7, 1.0, 0.7, 0.4].map((h, i) => (
            <div
              key={i}
              className="w-1.5 rounded-full bg-[#00B6A3]"
              style={{
                height: `${h * 32}px`,
                opacity: 0.6 + h * 0.4,
                animation: `bounce 1.2s ease-in-out ${i * 0.1}s infinite alternate`,
              }}
            />
          ))}
        </div>
        <p className="text-[15px] text-gray-500">일지를 작성하고 있습니다...</p>
      </div>

      {/* ActionBar — PROCESSING 중에도 표시 */}
      <div className="border-t border-gray-100 px-4 pt-3 pb-6 bg-white">
        <div className="flex gap-2">
          <button className="flex-1 h-12 rounded-xl bg-gray-100 text-[15px] font-medium text-gray-400" disabled>취소</button>
          <button className="flex-1 h-12 rounded-xl bg-[#00B6A3]/40 text-[15px] font-semibold text-white" disabled>AI 작성</button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          from { transform: scaleY(0.6); }
          to { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
