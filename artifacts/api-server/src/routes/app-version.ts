/**
 * GET /app-version — 앱 버전 체크 (인증 불필요)
 *
 * 응답:
 *   min_version    : 이 미만이면 강제 업데이트 (앱 사용 불가)
 *   latest_version : 이 미만이면 소프트 업데이트 권유
 *
 * 변경 방법: 아래 MIN_VERSION / LATEST_VERSION 상수만 수정 후 서버 재배포
 */
import { Router } from "express";

const router = Router();

const IOS_MIN_VERSION     = "1.6.2";
const IOS_LATEST_VERSION  = "1.6.2";
const AOS_MIN_VERSION     = "1.6.2";
const AOS_LATEST_VERSION  = "1.6.2";

router.get("/app-version", (_req, res) => {
  res.json({
    ios: {
      min_version:    IOS_MIN_VERSION,
      latest_version: IOS_LATEST_VERSION,
    },
    android: {
      min_version:    AOS_MIN_VERSION,
      latest_version: AOS_LATEST_VERSION,
    },
    store_urls: {
      ios:     "https://apps.apple.com/app/id6761360360",
      android: "https://play.google.com/store/apps/details?id=com.swimnote.app",
    },
  });
});

export default router;
