export function DiaryCard() {
  const photos = [
    "https://images.unsplash.com/photo-1560090995-dab4c1e5e6b1?w=200&h=200&fit=crop",
    "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=200&h=200&fit=crop",
    "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=200&h=200&fit=crop",
    "https://images.unsplash.com/photo-1519315901367-f34ff9154487?w=200&h=200&fit=crop",
    "https://images.unsplash.com/photo-1544717305-2782549b5136?w=200&h=200&fit=crop",
    "https://images.unsplash.com/photo-1501238295340-c592c8b7e35d?w=200&h=200&fit=crop",
    "https://images.unsplash.com/photo-1510549833-d8b99a2dda76?w=200&h=200&fit=crop",
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center p-4 pt-8">
      <div className="w-[390px] flex flex-col gap-3">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-xs text-gray-400">← 뒤로</span>
          <span className="text-base font-semibold text-gray-800">수업일지</span>
          <span className="text-xs text-gray-400">서태동</span>
        </div>

        {/* 일지 카드 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

          {/* 카드 헤더 */}
          <div className="flex items-center gap-3 p-4">
            <div className="w-13 bg-teal-500 rounded-xl flex flex-col items-center py-2 px-3 shrink-0">
              <span className="text-[10px] text-white/80">4월</span>
              <span className="text-2xl font-bold text-white leading-tight">5</span>
              <span className="text-[10px] text-white/80">일</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800">서경민 선생님</span>
                <span className="text-[10px] bg-teal-50 text-teal-600 px-2 py-0.5 rounded-lg">목 17:00반</span>
              </div>
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">킥 동작을 차분하게 연습했습니다. 발차기 자세가 점점 안정되고 있습니다.</p>
            </div>
            <span className="text-gray-300 text-sm">▲</span>
          </div>

          {/* 펼쳐진 본문 */}
          <div className="px-4 pb-4 flex flex-col gap-3">
            <div className="h-px bg-gray-100" />

            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-500" />
              <span className="text-[10px] text-teal-500 uppercase tracking-wide">수업 내용</span>
            </div>

            <p className="text-sm text-gray-700 leading-relaxed pl-4">
              킥 동작을 차분하게 연습했습니다.<br />
              발차기 자세가 점점 안정되고 있습니다.<br />
              물 속에서 눈을 뜨는 연습을 했습니다.
            </p>

            {/* ★ DiaryPhotoStrip — 학부모 앱에서 정상 표시 */}
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex items-center gap-1 pl-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2EC4B6" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span className="text-[11px] text-teal-500">수업 사진 {photos.length}장</span>
                <span className="text-[10px] text-gray-400">· 탭하면 크게 볼 수 있어요</span>
              </div>

              {/* 가로 스크롤 썸네일 */}
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {photos.map((src, i) => (
                  <div key={i} className="relative shrink-0 w-[88px] h-[88px] rounded-xl overflow-hidden bg-gray-100">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <div className="absolute bottom-1.5 right-1.5 bg-black/45 rounded-lg p-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 반응 버튼 */}
          <div className="flex border-t border-gray-100">
            <button className="flex-1 flex items-center justify-center gap-1.5 py-3">
              <span className="text-base">👍</span>
              <span className="text-xs text-gray-400">좋아요</span>
            </button>
            <button className="flex-1 flex items-center justify-center gap-1.5 py-3">
              <span className="text-base">🙏</span>
              <span className="text-xs text-gray-400">감사합니다</span>
            </button>
            <button className="flex-1 flex items-center justify-center gap-1.5 py-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <span className="text-xs text-gray-400">쪽지달기</span>
            </button>
          </div>
        </div>

        {/* 두 번째 일지 카드 (접힌 상태) */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <div className="w-13 bg-teal-500 rounded-xl flex flex-col items-center py-2 px-3 shrink-0">
              <span className="text-[10px] text-white/80">4월</span>
              <span className="text-2xl font-bold text-white leading-tight">1</span>
              <span className="text-[10px] text-white/80">수</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">서경민 선생님</span>
                <span className="text-[10px] bg-teal-50 text-teal-600 px-2 py-0.5 rounded-lg">목 17:00반</span>
              </div>
              <p className="text-xs text-gray-400 mt-1 line-clamp-2">자유형 팔 동작과 호흡 타이밍을 집중 연습했습니다.</p>
            </div>
            <span className="text-gray-300 text-sm">▼</span>
          </div>
        </div>

      </div>
    </div>
  );
}
