/**
 * utils/diaryShare.ts — 수업 일지 공유 유틸리티
 *
 * 현재: React Native Share API → 카카오톡 포함 네이티브 공유 시트
 * 업그레이드 예정: 카카오링크 SDK (카카오 앱 키 발급 후 EAS 빌드 시 활성화)
 */
import { Platform, Share } from "react-native";

const IOS_URL   = "https://apps.apple.com/app/id6738888898";
const AND_URL   = "https://play.google.com/store/apps/details?id=com.swimnote.app";
const STORE_URL = Platform.OS === "ios" ? IOS_URL : AND_URL;

export interface DiaryShareParams {
  studentName?:  string;
  className:     string;
  teacherName:   string;
  lessonDate:    string;
  content:       string;
  noteContent?:  string;
}

function fmtDate(iso: string) {
  const d    = new Date(iso + "T12:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

/* ─────────────────────────────────────────────────────────────
   메인 공유 함수
   ─────────────────────────────────────────────────────────── */
export async function shareDiaryEntry(params: DiaryShareParams) {
  const { studentName, className, teacherName, lessonDate, content, noteContent } = params;

  const lines: string[] = [];

  lines.push(studentName ? `🏊 ${studentName}의 수업 일지` : "🏊 수업 일지");
  lines.push(`📅 ${fmtDate(lessonDate)}`);
  lines.push(`🏫 ${className} · ${teacherName} 선생님`);
  lines.push("");
  lines.push("📝 오늘의 수업");
  lines.push(content.trim());

  if (noteContent) {
    lines.push("");
    lines.push("👤 개인 피드백");
    lines.push(noteContent.trim());
  }

  lines.push("");
  lines.push("─────────────────────");
  lines.push("💙 스윔노트 앱");
  lines.push("수업 일지·출결·학부모 소통을 한 곳에서");
  lines.push(STORE_URL);

  const message = lines.join("\n");
  const title   = studentName ? `${studentName}의 수업 일지` : "수업 일지";

  try {
    /* ── 향후: 카카오링크 SDK로 교체 예정 ──────────────────────
       카카오 네이티브 앱 키 발급 + EAS 빌드 후 아래 코드 활성화
       ─────────────────────────────────────────────────────────
       import KakaoShareLink from "react-native-kakao-share-link";
       await KakaoShareLink.sendFeed({
         content: {
           title,
           imageUrl: "https://swimnote.app/share-card.png",
           link: { webUrl: STORE_URL, mobileWebUrl: STORE_URL },
           description: content.slice(0, 100),
         },
         buttons: [{
           title: "스윔노트 앱에서 보기",
           link: {
             androidExecutionParams: "screen=diary",
             iosExecutionParams:     "screen=diary",
           },
         }],
       });
       ──────────────────────────────────────────────────────── */
    await Share.share({ message, title });
  } catch (_) {
    // 사용자 취소 또는 오류 — 무시
  }
}
