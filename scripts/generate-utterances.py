#!/usr/bin/env python3
"""
WP-CS23C: Generate support-intent-utterances.json from canonical answers.

Each intent gets Korean variants: CANONICAL / POLITE / CASUAL / SHORT /
COMMAND / QUESTION / SPACING / ALIAS / TYPO.

knowledge_id resolution:
  - existing_ki present   → reference that ACTIVE ki_* item
  - existing_ki absent    → reference answer_id (new candidate, not yet in DB)
"""

import json, re, unicodedata, sys

# ── normalizeQuery (matches support-resolver.ts) ──────────────────────────────

def normalize_query(q: str) -> str:
    q = q.lower()
    q = re.sub(r'([\uAC00-\uD7A3])([A-Za-z0-9])', r'\1 \2', q)
    q = re.sub(r'([A-Za-z0-9])([\uAC00-\uD7A3])', r'\1 \2', q)
    q = re.sub(r'에\s*대해서', '에 대해 ', q)
    q = re.sub(r'에\s*대해', '에 대해 ', q)
    q = re.sub(r'[이가]\s*뭐야', '가 뭐야 ', q)
    q = re.sub(r'[이가]\s*뭔지', '가 뭔지 ', q)
    q = re.sub(r'\s+', ' ', q)
    return q.strip()

# ── Utterance definitions ─────────────────────────────────────────────────────
# Format: (variant_type, utterance_text, weight)
# knowledge_id = existing_ki if present, else answer_id

UTTERANCES_BY_INTENT = {

  # ══════════════════════════════════════════════════════
  # PRODUCT
  # ══════════════════════════════════════════════════════

  "SN_PRODUCT_WHAT": [  # knowledge: ki_swimnote_intro, LOW
    ("CANONICAL", "스윔노트가 무엇인가요?", 100),
    ("POLITE", "스윔노트는 어떤 앱인가요?", 90),
    ("POLITE", "스윔노트 앱에 대해 소개해 주세요.", 90),
    ("CASUAL", "스윔노트가 뭐야?", 90),
    ("CASUAL", "스윔노트 뭐하는 앱이야?", 90),
    ("SHORT", "스윔노트란", 80),
    ("SHORT", "스윔노트 소개", 80),
    ("ALIAS", "swimnote가 뭔가요?", 85),
    ("ALIAS", "SWIMNOTE 앱 소개", 85),
  ],

  "SN_PRODUCT_ROLES": [  # knowledge: SN_PRODUCT_ROLES (new), LOW
    ("CANONICAL", "스윔노트 사용자 역할은 어떻게 구분되나요?", 100),
    ("POLITE", "사용자 역할 종류가 어떻게 되나요?", 90),
    ("POLITE", "관리자, 강사, 학부모 역할 차이가 궁금해요.", 90),
    ("CASUAL", "역할이 몇 가지야?", 85),
    ("SHORT", "사용자 역할", 80),
    ("SHORT", "역할 종류", 80),
    ("QUESTION", "강사랑 관리자 역할이 달라요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # ACCOUNT
  # ══════════════════════════════════════════════════════

  "SN_ACCOUNT_SIGNUP_ADMIN": [  # knowledge: SN_ACCOUNT_SIGNUP_ADMIN (new), LOW
    ("CANONICAL", "수영장 관리자는 어떻게 가입하나요?", 100),
    ("POLITE", "관리자 계정 가입 방법을 알려주세요.", 90),
    ("POLITE", "수영장 대표로 가입하려면 어떻게 하나요?", 90),
    ("CASUAL", "관리자로 가입하는 방법이 어떻게 돼?", 85),
    ("SHORT", "관리자 가입", 80),
    ("SHORT", "수영장 관리자 가입 방법", 80),
    ("COMMAND", "관리자 가입 방법 알려줘", 85),
  ],

  "SN_ACCOUNT_SIGNUP_TEACHER": [  # knowledge: SN_ACCOUNT_SIGNUP_TEACHER (new), MEDIUM
    ("CANONICAL", "강사로 가입하는 방법은 무엇인가요?", 100),
    ("POLITE", "강사 계정은 어떻게 만드나요?", 90),
    ("POLITE", "선생님 가입 방법을 알려주세요.", 90),
    ("POLITE", "강사 가입 절차가 어떻게 되나요?", 90),
    ("CASUAL", "강사로 가입하는 방법이 뭐야?", 85),
    ("CASUAL", "선생님 가입 어떻게 해?", 85),
    ("SHORT", "강사 가입", 80),
    ("SHORT", "강사 계정 만들기", 80),
    ("COMMAND", "강사로 가입하는 방법 알려줘", 85),
    ("QUESTION", "초대 코드 없이 강사로 가입 가능한가요?", 85),
    ("ALIAS", "teacher 가입 방법", 80),
    ("SPACING", "강사가입방법", 75),
  ],

  "SN_ACCOUNT_SIGNUP_PARENT": [  # knowledge: SN_ACCOUNT_SIGNUP_PARENT (new), MEDIUM
    ("CANONICAL", "학부모는 어떻게 가입하나요?", 100),
    ("POLITE", "학부모 계정 가입 방법을 알려주세요.", 90),
    ("POLITE", "부모 계정은 어떻게 만드나요?", 90),
    ("CASUAL", "학부모로 가입하는 방법이 뭐야?", 85),
    ("CASUAL", "엄마 계정은 어떻게 만들어?", 85),
    ("SHORT", "학부모 가입", 80),
    ("SHORT", "학부모 계정 만들기", 80),
    ("COMMAND", "학부모 가입 방법 알려줘", 85),
    ("QUESTION", "학부모 가입 시 자녀 정보가 필요한가요?", 85),
    ("ALIAS", "parent 가입", 80),
    ("POLITE", "보호자 계정 가입은 어떻게 하나요?", 90),
  ],

  "SN_ACCOUNT_WITHDRAWAL": [  # knowledge: ki_cs12_account_withdrawal, LOW
    ("CANONICAL", "회원 탈퇴는 어떻게 하나요?", 100),
    ("POLITE", "탈퇴 방법을 알려주세요.", 90),
    ("POLITE", "앱 탈퇴는 어떻게 신청하나요?", 90),
    ("CASUAL", "탈퇴하는 방법이 뭐야?", 85),
    ("SHORT", "탈퇴", 80),
    ("SHORT", "회원 탈퇴 방법", 80),
    ("COMMAND", "탈퇴 방법 알려줘", 85),
    ("QUESTION", "탈퇴하면 데이터가 삭제되나요?", 85),
  ],

  "SN_ACCOUNT_WITHDRAWAL_ADMIN_DEFERRED": [  # knowledge: ki_cs12_pool_admin_withdrawal_deferred, LOW
    ("CANONICAL", "관리자 탈퇴 후 90일 유예기간이란 무엇인가요?", 100),
    ("POLITE", "관리자 탈퇴 시 유예 기간에 대해 알려주세요.", 90),
    ("POLITE", "관리자 계정 탈퇴 절차가 어떻게 되나요?", 90),
    ("CASUAL", "관리자 탈퇴하면 바로 삭제돼?", 85),
    ("SHORT", "관리자 탈퇴 유예기간", 80),
    ("QUESTION", "탈퇴 유예기간 동안 데이터 사용 가능한가요?", 85),
  ],

  "SN_ACCOUNT_INVITE_TEACHER": [  # knowledge: SN_ACCOUNT_INVITE_TEACHER (new), MEDIUM
    ("CANONICAL", "강사 초대 코드는 어떻게 발급하나요?", 100),
    ("POLITE", "강사 초대는 어떻게 하나요?", 90),
    ("POLITE", "선생님 초대 코드 발급 방법이 궁금해요.", 90),
    ("POLITE", "QR 코드로 강사를 초대하려면 어떻게 하나요?", 90),
    ("CASUAL", "강사 초대 어떻게 해?", 85),
    ("CASUAL", "선생님 초대 코드 어디서 받아?", 85),
    ("SHORT", "강사 초대 코드", 80),
    ("SHORT", "초대 코드 발급", 80),
    ("COMMAND", "강사 초대 방법 알려줘", 85),
    ("QUESTION", "강사 초대 코드는 어디서 발급하나요?", 85),
    ("ALIAS", "QR 초대 방법", 85),
  ],

  "SN_ACCOUNT_TEACHER_PENDING_APPROVAL": [  # knowledge: SN_ACCOUNT_TEACHER_PENDING_APPROVAL (new), LOW
    ("CANONICAL", "강사 가입 후 대기 상태인 이유는 무엇인가요?", 100),
    ("POLITE", "가입했는데 왜 대기 중인가요?", 90),
    ("POLITE", "강사 승인은 얼마나 걸리나요?", 90),
    ("CASUAL", "강사로 가입했는데 왜 대기야?", 85),
    ("SHORT", "강사 승인 대기", 80),
    ("QUESTION", "강사 가입 후 언제 사용할 수 있나요?", 85),
  ],

  "SN_ACCOUNT_POOL_ACCESS_DENIED": [  # knowledge: ki_cs12_pool_access_denied, LOW
    ("CANONICAL", "수영장 접근이 거부되었습니다. 어떻게 하나요?", 100),
    ("POLITE", "수영장 접근 오류가 발생했어요.", 90),
    ("POLITE", "수영장에 접근이 안 됩니다.", 90),
    ("CASUAL", "수영장 접근이 안 돼. 왜 그래?", 85),
    ("SHORT", "수영장 접근 거부", 80),
    ("SHORT", "접근 오류", 80),
    ("QUESTION", "왜 수영장 화면에 들어가지지 않나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # ROLE PERMISSION
  # ══════════════════════════════════════════════════════

  "SN_ROLE_PERMISSION_TEACHER": [  # knowledge: SN_ROLE_PERMISSION_TEACHER (new), MEDIUM
    ("CANONICAL", "강사는 어떤 기능을 사용할 수 있나요?", 100),
    ("POLITE", "강사 권한 범위가 어떻게 되나요?", 90),
    ("POLITE", "강사가 할 수 있는 것과 없는 것이 뭔가요?", 90),
    ("POLITE", "선생님이 사용할 수 있는 기능은 어디까지인가요?", 90),
    ("CASUAL", "강사가 뭘 할 수 있어?", 85),
    ("CASUAL", "선생님 권한이 어디까지야?", 85),
    ("SHORT", "강사 권한", 80),
    ("SHORT", "선생님 기능", 80),
    ("COMMAND", "강사 권한 범위 알려줘", 85),
    ("QUESTION", "강사도 공지사항을 작성할 수 있나요?", 85),
    ("QUESTION", "강사가 출결 삭제할 수 있나요?", 85),
  ],

  "SN_ROLE_PERMISSION_SUB_ADMIN": [  # knowledge: SN_ROLE_PERMISSION_SUB_ADMIN (new), MEDIUM
    ("CANONICAL", "부 관리자(sub_admin)와 관리자 차이는 무엇인가요?", 100),
    ("POLITE", "부 관리자와 수영장 대표의 차이가 궁금해요.", 90),
    ("POLITE", "sub_admin 권한은 어디까지인가요?", 90),
    ("CASUAL", "부관리자랑 관리자가 뭐가 달라?", 85),
    ("SHORT", "부 관리자 권한", 80),
    ("SHORT", "부관리자 기능 차이", 80),
    ("QUESTION", "부 관리자도 X 모드 설정할 수 있나요?", 85),
    ("QUESTION", "sub_admin이 결제를 할 수 있나요?", 85),
    ("ALIAS", "sub admin 권한", 80),
    ("COMMAND", "부관리자 권한 범위 알려줘", 85),
    ("SPACING", "부관리자와 관리자 차이", 80),
  ],

  # ══════════════════════════════════════════════════════
  # ATTENDANCE
  # ══════════════════════════════════════════════════════

  "SN_ATTENDANCE_PERMISSION": [  # knowledge: ki_cs12_attendance_permission, LOW
    ("CANONICAL", "출결은 누가 기록할 수 있나요?", 100),
    ("POLITE", "출결 기록 권한이 어떻게 되나요?", 90),
    ("POLITE", "출결은 누가 수정할 수 있나요?", 90),
    ("CASUAL", "출결 기록할 수 있는 사람이 누구야?", 85),
    ("SHORT", "출결 권한", 80),
    ("QUESTION", "학부모도 출결을 수정할 수 있나요?", 85),
    ("QUESTION", "강사가 출결을 삭제할 수 있나요?", 85),
  ],

  "SN_ATTENDANCE_HOW_MARK": [  # knowledge: SN_ATTENDANCE_HOW_MARK (new), MEDIUM
    ("CANONICAL", "출결은 어디서 기록하나요?", 100),
    ("POLITE", "출결 기록 방법을 알려주세요.", 90),
    ("POLITE", "출석 체크는 어떻게 하나요?", 90),
    ("POLITE", "결석 처리하는 방법이 궁금해요.", 90),
    ("CASUAL", "출결 어디서 기록해?", 85),
    ("CASUAL", "출석 체크 어떻게 해?", 85),
    ("SHORT", "출결 기록 방법", 80),
    ("SHORT", "출석 체크", 80),
    ("COMMAND", "출결 기록하는 방법 알려줘", 85),
    ("QUESTION", "오늘 출결은 어디서 처리하나요?", 85),
    ("ALIAS", "attendance 기록 방법", 75),
  ],

  "SN_ATTENDANCE_PARENT_VIEW": [  # knowledge: SN_ATTENDANCE_PARENT_VIEW (new), LOW
    ("CANONICAL", "학부모가 자녀 출결을 확인하는 방법은?", 100),
    ("POLITE", "자녀 출결 내역은 어디서 볼 수 있나요?", 90),
    ("POLITE", "아이 출석 확인하는 방법을 알려주세요.", 90),
    ("CASUAL", "아이 출결 어디서 봐?", 85),
    ("SHORT", "자녀 출결 확인", 80),
    ("QUESTION", "학부모 앱에서 출석률을 볼 수 있나요?", 85),
  ],

  "SN_ATTENDANCE_ERROR_SAVE": [  # knowledge: ki_cs12_attendance_save_failed, LOW
    ("CANONICAL", "출결 저장이 안 돼요.", 100),
    ("POLITE", "출결 저장이 안 됩니다. 어떻게 해야 하나요?", 90),
    ("POLITE", "출석 저장 오류가 발생했어요.", 90),
    ("CASUAL", "출결 저장이 왜 안 돼?", 85),
    ("SHORT", "출결 저장 오류", 80),
    ("SHORT", "출석 저장 안됨", 80),
    ("QUESTION", "출결이 저장되지 않는 이유가 뭔가요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # DIARY
  # ══════════════════════════════════════════════════════

  "SN_DIARY_WHAT": [  # knowledge: SN_DIARY_WHAT (new), LOW
    ("CANONICAL", "수업 일지가 무엇인가요?", 100),
    ("POLITE", "수업 일지 기능에 대해 알려주세요.", 90),
    ("POLITE", "일지는 어떤 기능인가요?", 90),
    ("CASUAL", "수업 일지가 뭐야?", 85),
    ("SHORT", "수업 일지란", 80),
    ("SHORT", "일지 기능", 80),
    ("QUESTION", "수업 일지와 개인 일지 차이가 뭔가요?", 85),
  ],

  "SN_DIARY_CREATE_REQUIREMENT": [  # knowledge: SN_DIARY_CREATE_REQUIREMENT (new), LOW
    ("CANONICAL", "일지를 저장하려면 무엇이 필요한가요?", 100),
    ("POLITE", "일지 저장 조건이 어떻게 되나요?", 90),
    ("POLITE", "일지 작성 시 필수 항목이 있나요?", 90),
    ("CASUAL", "일지 저장 조건이 뭐야?", 85),
    ("SHORT", "일지 저장 조건", 80),
    ("QUESTION", "출석 학생이 없으면 일지 저장이 안 되나요?", 85),
  ],

  "SN_DIARY_SAVE_FAIL": [  # knowledge: ki_cs12_diary_save_failed, LOW
    ("CANONICAL", "일지 저장이 안 됩니다.", 100),
    ("POLITE", "수업 일지 저장이 안 돼요. 어떻게 해야 하나요?", 90),
    ("POLITE", "일지 저장 오류가 발생했습니다.", 90),
    ("CASUAL", "일지가 왜 저장이 안 돼?", 85),
    ("SHORT", "일지 저장 오류", 80),
    ("SHORT", "일지 저장 안됨", 80),
    ("QUESTION", "일지 저장 실패 원인이 뭔가요?", 85),
  ],

  "SN_DIARY_PHOTO_LIMIT": [  # knowledge: SN_DIARY_PHOTO_LIMIT (new), LOW
    ("CANONICAL", "일지에 사진을 몇 장까지 첨부할 수 있나요?", 100),
    ("POLITE", "일지 사진 첨부 한도가 어떻게 되나요?", 90),
    ("POLITE", "일지에 올릴 수 있는 사진 수가 정해져 있나요?", 90),
    ("CASUAL", "일지 사진 몇 장까지 올려?", 85),
    ("SHORT", "일지 사진 제한", 80),
    ("QUESTION", "일지 사진 한 장 크기 제한이 있나요?", 85),
  ],

  "SN_DIARY_PHOTO_UPLOAD_FAIL": [  # knowledge: ki_cs12_diary_photo_upload_failed, LOW
    ("CANONICAL", "일지 사진 업로드가 실패해요.", 100),
    ("POLITE", "일지에 사진을 올리려는데 업로드가 안 됩니다.", 90),
    ("POLITE", "수업 일지 사진 첨부가 안 돼요.", 90),
    ("CASUAL", "일지 사진이 왜 안 올라가?", 85),
    ("SHORT", "일지 사진 업로드 오류", 80),
    ("SHORT", "일지 사진 안 올라감", 80),
    ("QUESTION", "일지 사진 업로드 실패 원인이 뭔가요?", 85),
  ],

  "SN_DIARY_PARENT_VIEW_CONDITION": [  # knowledge: SN_DIARY_PARENT_VIEW_CONDITION (new), LOW
    ("CANONICAL", "학부모는 언제 수업 일지를 볼 수 있나요?", 100),
    ("POLITE", "학부모 앱에서 일지는 언제 표시되나요?", 90),
    ("POLITE", "강사가 일지를 저장하면 바로 학부모가 볼 수 있나요?", 90),
    ("CASUAL", "일지 저장하면 바로 학부모가 볼 수 있어?", 85),
    ("SHORT", "학부모 일지 공개 조건", 80),
    ("QUESTION", "일지 작성 후 학부모가 바로 볼 수 있나요?", 85),
  ],

  "SN_DIARY_PARENT_NOT_VISIBLE": [  # knowledge: ki_cs12_parent_diary_not_visible, MEDIUM
    ("CANONICAL", "학부모 앱에서 수업 일지가 안 보여요.", 100),
    ("POLITE", "학부모 앱에 수업 일지가 표시되지 않아요.", 90),
    ("POLITE", "아이 일지를 볼 수가 없어요.", 90),
    ("CASUAL", "학부모 앱에서 일지가 왜 안 보여?", 85),
    ("CASUAL", "아이 일지가 없어졌어요", 85),
    ("SHORT", "학부모 일지 안보임", 80),
    ("SHORT", "일지 안 보여요", 80),
    ("QUESTION", "강사가 일지를 썼는데 학부모 앱에 안 보이는 이유가 뭔가요?", 85),
    ("QUESTION", "자녀 일지가 학부모 앱에 표시되지 않는 이유는?", 85),
    ("COMMAND", "학부모 일지 안보이는 이유 알려줘", 85),
    ("TYPO", "학부모 앱에서 수업 일지가 안보여요", 75),
  ],

  # ══════════════════════════════════════════════════════
  # AI DIARY
  # ══════════════════════════════════════════════════════

  "SN_DIARY_AI_WHAT": [  # knowledge: SN_DIARY_AI_WHAT (new), MEDIUM
    ("CANONICAL", "AI 일지 자동 생성이란 무엇인가요?", 100),
    ("POLITE", "AI 일지 기능에 대해 알려주세요.", 90),
    ("POLITE", "AI가 일지를 자동으로 작성해 주나요?", 90),
    ("CASUAL", "AI 일지가 뭐야?", 85),
    ("CASUAL", "AI로 일지 자동 작성이 돼?", 85),
    ("SHORT", "AI 일지란", 80),
    ("SHORT", "AI 일지 기능", 80),
    ("ALIAS", "AI diary 기능", 80),
    ("QUESTION", "AI 일지와 일반 일지 차이가 뭔가요?", 85),
  ],

  "SN_DIARY_AI_XMODE_REQUIRED": [  # knowledge: SN_DIARY_AI_XMODE_REQUIRED (new), LOW
    ("CANONICAL", "AI 일지 기능은 X 모드에서만 사용할 수 있나요?", 100),
    ("POLITE", "AI 일지를 사용하려면 X 모드가 필요한가요?", 90),
    ("POLITE", "일반 모드에서도 AI 일지를 쓸 수 있나요?", 90),
    ("CASUAL", "AI 일지 쓰려면 X 모드여야 해?", 85),
    ("SHORT", "AI 일지 X 모드 필요", 80),
    ("QUESTION", "X 모드 아닌데 AI 일지 버튼이 없어요. 왜 그런가요?", 85),
  ],

  "SN_DIARY_AI_FAIL": [  # knowledge: ki_cs12_diary_ai_failed, LOW
    ("CANONICAL", "AI 일지 자동 생성이 실패했어요.", 100),
    ("POLITE", "AI 일지 생성에 오류가 발생했습니다.", 90),
    ("POLITE", "AI 일지가 만들어지지 않아요.", 90),
    ("CASUAL", "AI 일지가 왜 안 만들어져?", 85),
    ("SHORT", "AI 일지 오류", 80),
    ("SHORT", "AI 일지 실패", 80),
    ("QUESTION", "AI 일지 생성 실패 원인이 뭔가요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # PHOTO
  # ══════════════════════════════════════════════════════

  "SN_PHOTO_WHO_CAN_UPLOAD": [  # knowledge: SN_PHOTO_WHO_CAN_UPLOAD (new), LOW
    ("CANONICAL", "사진은 누가 올릴 수 있나요?", 100),
    ("POLITE", "사진 업로드 권한이 누구에게 있나요?", 90),
    ("POLITE", "학부모도 사진을 올릴 수 있나요?", 90),
    ("CASUAL", "사진 올릴 수 있는 사람이 누구야?", 85),
    ("SHORT", "사진 업로드 권한", 80),
    ("QUESTION", "강사가 사진을 올릴 수 있나요?", 85),
  ],

  "SN_PHOTO_PARENT_NOT_VISIBLE": [  # knowledge: ki_cs22_parent_photo_not_visible, MEDIUM
    ("CANONICAL", "학부모 앱에서 자녀 사진이 안 보여요.", 100),
    ("POLITE", "학부모 앱에서 아이 사진을 볼 수 없어요.", 90),
    ("POLITE", "앨범에 사진이 표시되지 않습니다.", 90),
    ("CASUAL", "아이 사진이 앱에서 안 보여요", 85),
    ("CASUAL", "학부모 앱 앨범이 비어 있어요", 85),
    ("SHORT", "학부모 사진 안보임", 80),
    ("SHORT", "앨범에 사진 없음", 80),
    ("QUESTION", "강사가 사진을 올렸는데 학부모 앱에 안 보이는 이유가 뭔가요?", 85),
    ("COMMAND", "학부모 앱 사진 안보이는 이유 알려줘", 85),
    ("TYPO", "학부모앱에서 사진이 안보여요", 75),
  ],

  "SN_PHOTO_STORAGE_LIMIT": [  # knowledge: SN_PHOTO_STORAGE_LIMIT (new), MEDIUM
    ("CANONICAL", "사진·영상 저장 공간이 부족해요.", 100),
    ("POLITE", "저장 공간이 부족합니다. 어떻게 해야 하나요?", 90),
    ("POLITE", "사진 저장 공간을 늘리려면 어떻게 하나요?", 90),
    ("CASUAL", "저장공간이 부족하다는데 어떻게 해?", 85),
    ("SHORT", "저장공간 부족", 80),
    ("SHORT", "용량 초과", 80),
    ("QUESTION", "사진·영상 저장 공간이 얼마나 되나요?", 85),
    ("QUESTION", "저장 공간이 초과되면 어떻게 되나요?", 85),
    ("COMMAND", "저장 공간 늘리는 방법 알려줘", 85),
    ("ALIAS", "스토리지 부족", 80),
    ("TYPO", "저장 공간이 부족해요", 80),
  ],

  # ══════════════════════════════════════════════════════
  # NOTICE
  # ══════════════════════════════════════════════════════

  "SN_NOTICE_WHO_CAN_CREATE": [  # knowledge: SN_NOTICE_WHO_CAN_CREATE (new), LOW
    ("CANONICAL", "공지사항은 누가 작성할 수 있나요?", 100),
    ("POLITE", "공지사항 작성 권한이 누구에게 있나요?", 90),
    ("POLITE", "강사도 공지를 올릴 수 있나요?", 90),
    ("CASUAL", "공지 작성할 수 있는 사람이 누구야?", 85),
    ("SHORT", "공지사항 권한", 80),
    ("QUESTION", "강사가 공지를 작성할 수 있나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # MAKEUP
  # ══════════════════════════════════════════════════════

  "SN_MAKEUP_WHAT": [  # knowledge: SN_MAKEUP_WHAT (new), LOW
    ("CANONICAL", "보강이란 무엇인가요?", 100),
    ("POLITE", "보강 기능에 대해 알려주세요.", 90),
    ("POLITE", "보강 수업은 어떤 건가요?", 90),
    ("CASUAL", "보강이 뭐야?", 85),
    ("SHORT", "보강이란", 80),
    ("SHORT", "보강 기능", 80),
    ("QUESTION", "결석하면 보강이 자동으로 생기나요?", 85),
  ],

  "SN_MAKEUP_DATE_RANGE": [  # knowledge: ki_cs22_makeup_failure, LOW
    ("CANONICAL", "보강 날짜는 언제까지 선택할 수 있나요?", 100),
    ("POLITE", "보강 가능한 날짜 범위가 어떻게 되나요?", 90),
    ("POLITE", "보강 신청 가능한 기간은 언제까지인가요?", 90),
    ("CASUAL", "보강 날짜 범위가 어떻게 돼?", 85),
    ("SHORT", "보강 날짜 범위", 80),
    ("QUESTION", "2주 이상 지난 결석도 보강 처리가 되나요?", 85),
  ],

  "SN_MAKEUP_PARENT_REQUEST": [  # knowledge: ki_cs22_makeup_failure, MEDIUM
    ("CANONICAL", "학부모가 보강을 신청하려면 어떻게 하나요?", 100),
    ("POLITE", "학부모가 보강을 요청하는 방법이 궁금해요.", 90),
    ("POLITE", "보호자가 보강 신청을 하려면 어떻게 해야 하나요?", 90),
    ("CASUAL", "학부모가 보강 신청하는 방법이 뭐야?", 85),
    ("CASUAL", "엄마가 보강 요청하려면 어떻게 해?", 85),
    ("SHORT", "학부모 보강 신청", 80),
    ("SHORT", "보강 요청 방법", 80),
    ("COMMAND", "학부모 보강 신청 방법 알려줘", 85),
    ("QUESTION", "학부모가 직접 보강 날짜를 지정할 수 있나요?", 85),
    ("ALIAS", "보호자 보강 신청", 80),
  ],

  "SN_MAKEUP_ERROR": [  # knowledge: ki_cs22_makeup_failure, LOW
    ("CANONICAL", "보강 신청·처리 오류가 발생했어요.", 100),
    ("POLITE", "보강 처리가 안 됩니다. 어떻게 해야 하나요?", 90),
    ("POLITE", "보강 배정 오류가 발생했어요.", 90),
    ("CASUAL", "보강 처리가 왜 안 돼?", 85),
    ("SHORT", "보강 오류", 80),
    ("SHORT", "보강 처리 안됨", 80),
    ("QUESTION", "보강 날짜가 선택이 안 돼요. 왜 그런가요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # AI CURRICULUM SEARCH
  # ══════════════════════════════════════════════════════

  "SN_CURRICULUM_AI_WHAT": [  # knowledge: SN_CURRICULUM_AI_WHAT (new), MEDIUM
    ("CANONICAL", "AI 커리큘럼 상담이란 무엇인가요?", 100),
    ("POLITE", "AI 커리큘럼 상담 기능에 대해 알려주세요.", 90),
    ("POLITE", "커리큘럼 AI 상담은 어떤 기능인가요?", 90),
    ("CASUAL", "AI 커리큘럼 상담이 뭐야?", 85),
    ("SHORT", "AI 커리큘럼 상담", 80),
    ("SHORT", "커리큘럼 AI", 80),
    ("ALIAS", "curriculum AI 상담", 80),
    ("QUESTION", "AI가 커리큘럼을 추천해 주나요?", 85),
    ("ALIAS", "AI 커리큘럼 검색", 80),
  ],

  "SN_CURRICULUM_AI_QUOTA": [  # knowledge: SN_CURRICULUM_AI_QUOTA (new), LOW
    ("CANONICAL", "AI 커리큘럼 상담은 월에 몇 번 사용할 수 있나요?", 100),
    ("POLITE", "AI 커리큘럼 상담 월 사용 횟수가 어떻게 되나요?", 90),
    ("POLITE", "커리큘럼 AI 상담 횟수 제한이 있나요?", 90),
    ("CASUAL", "커리큘럼 AI 몇 번까지 써?", 85),
    ("SHORT", "AI 커리큘럼 상담 횟수", 80),
    ("QUESTION", "AI 커리큘럼 한도 초과 시 어떻게 되나요?", 85),
  ],

  "SN_CURRICULUM_AI_XPENDING_BLOCKED": [  # knowledge: SN_CURRICULUM_AI_XPENDING_BLOCKED (new), LOW
    ("CANONICAL", "X 설정 중(x_pending)에는 AI 커리큘럼 상담을 사용할 수 없나요?", 100),
    ("POLITE", "x_pending 상태에서 AI 커리큘럼을 사용할 수 없나요?", 90),
    ("POLITE", "X 모드 설정 중에 커리큘럼 AI가 안 됩니다.", 90),
    ("CASUAL", "X 설정 중인데 커리큘럼 AI가 막혀있어", 85),
    ("SHORT", "x_pending 커리큘럼 AI 차단", 80),
    ("QUESTION", "커리큘럼 AI 사용하려면 X 모드가 완전히 켜져야 하나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # GROWTH REPORT
  # ══════════════════════════════════════════════════════

  "SN_GROWTH_REPORT_WHAT": [  # knowledge: SN_GROWTH_REPORT_WHAT (new), MEDIUM
    ("CANONICAL", "성장 리포트란 무엇인가요?", 100),
    ("POLITE", "성장 리포트 기능에 대해 알려주세요.", 90),
    ("POLITE", "AI 성장 리포트는 어떤 기능인가요?", 90),
    ("CASUAL", "성장 리포트가 뭐야?", 85),
    ("SHORT", "성장 리포트란", 80),
    ("SHORT", "성장 리포트 기능", 80),
    ("QUESTION", "성장 리포트는 어떻게 생성되나요?", 85),
    ("ALIAS", "growth report 기능", 80),
    ("ALIAS", "성장판이 뭐야", 80),
  ],

  "SN_GROWTH_REPORT_PENDING": [  # knowledge: ki_cs12_growth_report_pending, MEDIUM
    ("CANONICAL", "성장 리포트가 생성 중인데 언제 완료되나요?", 100),
    ("POLITE", "성장 리포트가 대기 중입니다. 언제 완료되나요?", 90),
    ("POLITE", "성장 리포트 생성이 오래 걸립니다.", 90),
    ("CASUAL", "성장 리포트가 언제 완성돼?", 85),
    ("CASUAL", "성장 리포트 생성 중인데 왜 이렇게 오래 걸려?", 85),
    ("SHORT", "성장 리포트 대기 중", 80),
    ("SHORT", "리포트 생성 중", 80),
    ("QUESTION", "성장 리포트가 대기 상태인 이유가 뭔가요?", 85),
    ("COMMAND", "성장 리포트 대기 이유 알려줘", 85),
    ("TYPO", "성장리포트가 생성중인데 언제 완료되나요", 75),
  ],

  "SN_GROWTH_REPORT_PARENT_VIEW_CONDITION": [  # knowledge: SN_GROWTH_REPORT_PARENT_VIEW_CONDITION (new), MEDIUM
    ("CANONICAL", "학부모가 성장 리포트를 보려면 어떤 조건이 필요한가요?", 100),
    ("POLITE", "성장 리포트를 학부모가 볼 수 있는 조건이 뭔가요?", 90),
    ("POLITE", "성장 리포트가 언제 학부모에게 공개되나요?", 90),
    ("CASUAL", "성장 리포트 학부모가 언제 볼 수 있어?", 85),
    ("SHORT", "성장 리포트 공개 조건", 80),
    ("QUESTION", "성장 리포트가 학부모 앱에 안 보이는 이유가 뭔가요?", 85),
    ("QUESTION", "승인 후에도 성장 리포트가 안 보여요. 왜 그런가요?", 85),
    ("ALIAS", "성장 리포트 조회 조건", 80),
  ],

  "SN_GROWTH_REPORT_TEACHER_REVIEW": [  # knowledge: SN_GROWTH_REPORT_TEACHER_REVIEW (new), MEDIUM
    ("CANONICAL", "교사가 성장 리포트를 어떻게 검토하나요?", 100),
    ("POLITE", "성장 리포트 검토 방법을 알려주세요.", 90),
    ("POLITE", "강사가 성장 리포트를 어떻게 승인하나요?", 90),
    ("CASUAL", "성장 리포트 검토 어떻게 해?", 85),
    ("SHORT", "성장 리포트 검토", 80),
    ("SHORT", "리포트 승인 방법", 80),
    ("QUESTION", "성장 리포트 내용을 강사가 직접 수정할 수 있나요?", 85),
    ("QUESTION", "성장 리포트 재분석은 몇 번까지 가능한가요?", 85),
    ("COMMAND", "성장 리포트 검토 방법 알려줘", 85),
  ],

  # ══════════════════════════════════════════════════════
  # SWIMNOTE X
  # ══════════════════════════════════════════════════════

  "SN_X_WHAT": [  # knowledge: ki_x_mode_intro, MEDIUM
    ("CANONICAL", "SWIMNOTE X란 무엇인가요?", 100),
    ("POLITE", "SWIMNOTE X 기능에 대해 알려주세요.", 90),
    ("POLITE", "X 모드가 어떤 건지 궁금해요.", 90),
    ("CASUAL", "X 모드가 뭐야?", 85),
    ("CASUAL", "스윔노트 X가 뭐야?", 85),
    ("SHORT", "X 모드란", 80),
    ("SHORT", "스윔노트 X 소개", 80),
    ("ALIAS", "swimnote x 기능", 80),
    ("ALIAS", "x모드 소개", 80),
    ("SPACING", "x 모드", 80),
    ("QUESTION", "X 모드에서 추가로 사용할 수 있는 기능이 뭔가요?", 85),
  ],

  "SN_X_STATES": [  # knowledge: SN_X_STATES (new), MEDIUM
    ("CANONICAL", "X 모드 상태 종류는 어떻게 되나요?", 100),
    ("POLITE", "X 모드의 상태 종류가 어떻게 구분되나요?", 90),
    ("POLITE", "normal, x_pending, x의 차이가 궁금해요.", 90),
    ("CASUAL", "X 모드 상태가 몇 가지야?", 85),
    ("SHORT", "X 모드 상태", 80),
    ("QUESTION", "x_pending 상태는 어떤 상태인가요?", 85),
    ("QUESTION", "일반 모드와 X 모드 차이가 뭔가요?", 85),
    ("ALIAS", "x 모드 상태 종류", 80),
    ("COMMAND", "X 모드 상태 설명해줘", 85),
    ("SPACING", "x pending 상태", 80),
  ],

  "SN_X_SETUP_HOW": [  # knowledge: ki_cs12_x_setup_howto, MEDIUM
    ("CANONICAL", "X 모드 설정은 어떻게 하나요?", 100),
    ("POLITE", "X 모드 설정 방법을 알려주세요.", 90),
    ("POLITE", "SWIMNOTE X를 신청하려면 어떻게 해야 하나요?", 90),
    ("CASUAL", "X 모드 어떻게 설정해?", 85),
    ("CASUAL", "X 모드 신청 어떻게 해?", 85),
    ("SHORT", "X 모드 설정", 80),
    ("SHORT", "X 설정 방법", 80),
    ("COMMAND", "X 모드 설정 방법 알려줘", 85),
    ("QUESTION", "X 모드를 신청하면 바로 활성화되나요?", 85),
    ("ALIAS", "x mode 설정", 80),
    ("ALIAS", "swimnote x 신청 방법", 80),
    ("SPACING", "X모드설정방법", 75),
  ],

  "SN_X_SETUP_STATUS_FLOW": [  # knowledge: SN_X_SETUP_STATUS_FLOW (new), MEDIUM
    ("CANONICAL", "X 설정 검토 상태는 어떻게 변하나요?", 100),
    ("POLITE", "X 모드 설정 진행 상태가 어떻게 변하는지 알려주세요.", 90),
    ("POLITE", "X 설정 제출 후 어떤 과정으로 진행되나요?", 90),
    ("CASUAL", "X 설정 상태가 어떻게 바뀌어?", 85),
    ("SHORT", "X 설정 상태 변화", 80),
    ("QUESTION", "X 설정 제출 후 수정 요청이 오면 어떻게 하나요?", 85),
    ("QUESTION", "X 모드 검토 기간이 얼마나 걸리나요?", 85),
    ("COMMAND", "X 설정 검토 과정 설명해줘", 85),
  ],

  "SN_X_LOCK_STATES": [  # knowledge: ki_cs22_xmodeguard_lock_states, MEDIUM
    ("CANONICAL", "X 모드 잠금 화면이 뜨는 이유는 무엇인가요?", 100),
    ("POLITE", "X 모드 잠금 화면이 표시됩니다. 왜 그런가요?", 90),
    ("POLITE", "X 모드 잠금이 걸려 있어요. 어떻게 해야 하나요?", 90),
    ("CASUAL", "X 모드 잠금 화면이 뜨는 이유가 뭐야?", 85),
    ("CASUAL", "X 모드가 잠겨 있어요", 85),
    ("SHORT", "X 모드 잠금", 80),
    ("SHORT", "X모드 잠금 화면", 80),
    ("QUESTION", "curriculum_pending 상태는 어떤 건가요?", 85),
    ("QUESTION", "not_configured 잠금이 뜨면 어떻게 해야 하나요?", 85),
    ("ALIAS", "xmode guard 화면", 80),
    ("COMMAND", "X 모드 잠금 화면 이유 알려줘", 85),
  ],

  "SN_X_ENTITLEMENT_TYPES": [  # knowledge: SN_X_ENTITLEMENT_TYPES (new), MEDIUM
    ("CANONICAL", "X 모드는 어떻게 활성화되나요?", 100),
    ("POLITE", "X 모드 활성화 방법이 무엇인가요?", 90),
    ("POLITE", "X 모드를 사용하려면 무엇이 필요한가요?", 90),
    ("CASUAL", "X 모드 어떻게 켜?", 85),
    ("CASUAL", "X 모드 활성화하는 방법이 뭐야?", 85),
    ("SHORT", "X 모드 활성화", 80),
    ("SHORT", "X 엔타이틀먼트", 80),
    ("QUESTION", "유료 구독 없이 X 모드를 사용할 수 있나요?", 85),
    ("ALIAS", "x mode 활성화 방법", 80),
    ("COMMAND", "X 모드 켜는 방법 알려줘", 85),
  ],

  "SN_X_PRICE": [  # knowledge: SN_X_PRICE (new, HUMAN_ONLY), HIGH
    ("CANONICAL", "SWIMNOTE X 가격은 얼마인가요?", 100),
    ("POLITE", "X 모드 구독 가격이 얼마인지 알려주세요.", 90),
    ("POLITE", "스윔노트 X 이용료가 어떻게 되나요?", 90),
    ("POLITE", "X 모드 월 구독료가 궁금해요.", 90),
    ("CASUAL", "X 모드 가격이 얼마야?", 85),
    ("CASUAL", "스윔노트 X 얼마야?", 85),
    ("CASUAL", "X 모드 구독 비용이 얼마야?", 85),
    ("SHORT", "X 모드 가격", 80),
    ("SHORT", "X 모드 요금", 80),
    ("SHORT", "스윔노트 X 비용", 80),
    ("ALIAS", "swimnote x 가격", 80),
    ("ALIAS", "x mode 요금제", 80),
    ("QUESTION", "X 모드 구독은 월 단위인가요?", 85),
    ("QUESTION", "X 모드 할인 받을 수 있나요?", 85),
    ("COMMAND", "X 모드 가격 알려줘", 85),
    ("TYPO", "X모드 가격이 얼마예요", 75),
    ("QUESTION", "X 모드 1년 결제 가능한가요?", 85),
    ("QUESTION", "X 모드 비용 문의드립니다", 85),
  ],

  # ══════════════════════════════════════════════════════
  # NOTIFICATION
  # ══════════════════════════════════════════════════════

  "SN_NOTIFICATION_PUSH_IOS": [  # knowledge: ki_cs12_notification_permission_ios, LOW
    ("CANONICAL", "iPhone에서 알림 권한을 설정하는 방법은?", 100),
    ("POLITE", "아이폰에서 스윔노트 알림을 허용하려면 어떻게 하나요?", 90),
    ("POLITE", "iOS 알림 권한 설정 방법을 알려주세요.", 90),
    ("CASUAL", "아이폰에서 알림 권한 어떻게 켜?", 85),
    ("SHORT", "아이폰 알림 권한", 80),
    ("ALIAS", "iOS 알림 설정", 85),
    ("SPACING", "아이폰 알림권한", 75),
  ],

  "SN_NOTIFICATION_PUSH_ANDROID": [  # knowledge: ki_cs12_notification_permission_android, LOW
    ("CANONICAL", "안드로이드에서 알림 권한을 설정하는 방법은?", 100),
    ("POLITE", "갤럭시에서 스윔노트 알림을 허용하려면 어떻게 하나요?", 90),
    ("POLITE", "안드로이드 알림 권한 설정 방법을 알려주세요.", 90),
    ("CASUAL", "안드로이드에서 알림 켜는 방법이 뭐야?", 85),
    ("SHORT", "안드로이드 알림 권한", 80),
    ("ALIAS", "갤럭시 알림 설정", 85),
    ("SPACING", "안드로이드 알림권한", 75),
  ],

  "SN_NOTIFICATION_NOT_ARRIVING": [  # knowledge: ki_cs12_push_not_working, MEDIUM
    ("CANONICAL", "알림 권한을 켰는데 알림이 오지 않아요.", 100),
    ("POLITE", "알림 설정을 했는데도 알림이 오지 않습니다.", 90),
    ("POLITE", "푸시 알림이 수신되지 않아요.", 90),
    ("CASUAL", "알림 켰는데 왜 알림이 안 와?", 85),
    ("CASUAL", "알림이 안 와요", 85),
    ("SHORT", "알림 안옴", 80),
    ("SHORT", "푸시 알림 수신 안됨", 80),
    ("QUESTION", "알림 권한을 허용했는데 왜 알림이 안 오나요?", 85),
    ("COMMAND", "알림 안오는 이유 알려줘", 85),
    ("TYPO", "알람이 안와요", 75),
    ("TYPO", "알람 안옴", 75),
  ],

  "SN_NOTIFICATION_TYPES": [  # knowledge: SN_NOTIFICATION_TYPES (new), MEDIUM
    ("CANONICAL", "어떤 경우에 알림이 오나요?", 100),
    ("POLITE", "어떤 상황에서 알림이 발송되나요?", 90),
    ("POLITE", "알림을 받을 수 있는 이벤트가 어떻게 되나요?", 90),
    ("CASUAL", "어떤 때 알림 와?", 85),
    ("SHORT", "알림 이벤트 종류", 80),
    ("SHORT", "알림 발송 조건", 80),
    ("QUESTION", "일지 등록되면 알림이 오나요?", 85),
    ("QUESTION", "학부모한테 어떤 알림이 가나요?", 85),
    ("COMMAND", "알림 오는 경우 알려줘", 85),
  ],

  # ══════════════════════════════════════════════════════
  # SUPPORT
  # ══════════════════════════════════════════════════════

  "SN_SUPPORT_AI_WHAT": [  # knowledge: SN_SUPPORT_AI_WHAT (new), MEDIUM
    ("CANONICAL", "AI 문의란 무엇인가요?", 100),
    ("POLITE", "AI 문의 기능에 대해 알려주세요.", 90),
    ("POLITE", "AI 고객센터는 어떤 기능인가요?", 90),
    ("CASUAL", "AI 문의가 뭐야?", 85),
    ("SHORT", "AI 문의 기능", 80),
    ("ALIAS", "AI 고객센터", 80),
    ("QUESTION", "AI가 모든 질문에 답할 수 있나요?", 85),
    ("ALIAS", "support AI 기능", 80),
    ("QUESTION", "AI 문의는 어디서 사용할 수 있나요?", 85),
  ],

  "SN_SUPPORT_HUMAN_HOW": [  # knowledge: SN_SUPPORT_HUMAN_HOW (new), MEDIUM
    ("CANONICAL", "상담사에게 직접 문의하려면 어떻게 하나요?", 100),
    ("POLITE", "상담사 연결은 어떻게 하나요?", 90),
    ("POLITE", "직접 문의는 어떻게 하나요?", 90),
    ("CASUAL", "상담사 연결 어떻게 해?", 85),
    ("CASUAL", "사람한테 직접 문의하고 싶어요", 85),
    ("SHORT", "상담사 연결", 80),
    ("SHORT", "직접 문의", 80),
    ("COMMAND", "상담사 연결 방법 알려줘", 85),
    ("QUESTION", "AI 말고 사람한테 문의할 수 있나요?", 85),
    ("ALIAS", "human support 연결", 80),
  ],

  "SN_SUPPORT_CASE_STATUS": [  # knowledge: SN_SUPPORT_CASE_STATUS (new), MEDIUM
    ("CANONICAL", "문의 상태(AI 확인 중, 상담사 연결 대기 등)는 무슨 뜻인가요?", 100),
    ("POLITE", "문의 진행 상태가 어떤 의미인지 알려주세요.", 90),
    ("POLITE", "상담 상태 종류가 어떻게 되나요?", 90),
    ("CASUAL", "문의 상태가 무슨 뜻이야?", 85),
    ("SHORT", "문의 상태 의미", 80),
    ("QUESTION", "AI 확인 중 상태는 어떤 건가요?", 85),
    ("QUESTION", "해결 완료 상태가 되면 어떻게 되나요?", 85),
    ("ALIAS", "support case 상태", 80),
  ],

  # ══════════════════════════════════════════════════════
  # BILLING / SUBSCRIPTION
  # ══════════════════════════════════════════════════════

  "SN_BILLING_SUBSCRIPTION_WHAT": [  # knowledge: SN_BILLING_SUBSCRIPTION_WHAT (new), MEDIUM
    ("CANONICAL", "스윔노트 구독이란 무엇인가요?", 100),
    ("POLITE", "구독 기능에 대해 알려주세요.", 90),
    ("POLITE", "스윔노트 유료 구독이 어떤 건가요?", 90),
    ("CASUAL", "구독이 뭐야?", 85),
    ("CASUAL", "스윔노트 유료 서비스가 뭐야?", 85),
    ("SHORT", "구독이란", 80),
    ("SHORT", "구독 기능", 80),
    ("QUESTION", "구독은 어디서 결제하나요?", 85),
    ("ALIAS", "subscription 기능", 80),
    ("COMMAND", "구독 설명해줘", 85),
  ],

  "SN_BILLING_ERROR": [  # knowledge: ki_cs12_billing_error_triage, MEDIUM
    ("CANONICAL", "결제·구독 오류가 발생했어요.", 100),
    ("POLITE", "구독 결제에 오류가 발생했습니다.", 90),
    ("POLITE", "결제 오류가 나타납니다.", 90),
    ("CASUAL", "결제 오류가 왜 나?", 85),
    ("SHORT", "결제 오류", 80),
    ("SHORT", "구독 오류", 80),
    ("QUESTION", "결제 오류 원인이 뭔가요?", 85),
    ("COMMAND", "결제 오류 해결 방법 알려줘", 85),
    ("TYPO", "결제오류가 발생했어요", 75),
  ],

  "SN_BILLING_PAYMENT_FAIL": [  # knowledge: ki_cs12_billing_payment_failed, MEDIUM
    ("CANONICAL", "구독 결제가 실패했어요.", 100),
    ("POLITE", "구독 결제가 안 됩니다.", 90),
    ("POLITE", "결제 실패가 계속 발생합니다.", 90),
    ("CASUAL", "결제가 왜 안 돼?", 85),
    ("CASUAL", "구독 결제 실패했어", 85),
    ("SHORT", "결제 실패", 80),
    ("SHORT", "구독 결제 안됨", 80),
    ("QUESTION", "결제 실패 원인이 뭔가요?", 85),
    ("COMMAND", "결제 실패 해결 방법 알려줘", 85),
    ("ALIAS", "payment failed", 75),
  ],

  "SN_BILLING_REFUND": [  # knowledge: SN_BILLING_REFUND (new, HUMAN_ONLY), HIGH
    ("CANONICAL", "환불은 어떻게 받을 수 있나요?", 100),
    ("POLITE", "구독 환불 신청 방법을 알려주세요.", 90),
    ("POLITE", "결제 취소 및 환불은 어떻게 하나요?", 90),
    ("POLITE", "환불 요청을 하고 싶어요.", 90),
    ("CASUAL", "환불하는 방법이 뭐야?", 85),
    ("CASUAL", "환불 어떻게 해?", 85),
    ("CASUAL", "돈 돌려받는 방법이 뭐야?", 85),
    ("SHORT", "환불", 80),
    ("SHORT", "환불 방법", 80),
    ("SHORT", "구독 환불", 80),
    ("COMMAND", "환불 방법 알려줘", 85),
    ("QUESTION", "구독 취소하면 환불이 되나요?", 85),
    ("QUESTION", "환불 가능 기간이 어떻게 되나요?", 85),
    ("ALIAS", "refund 방법", 80),
    ("SPACING", "환불신청방법", 75),
    ("TYPO", "환불받는 방법이 뭐에요", 75),
    ("QUESTION", "결제했는데 바로 환불 가능한가요?", 85),
    ("QUESTION", "환불 처리는 얼마나 걸리나요?", 85),
    ("POLITE", "이미 결제한 구독을 취소하고 싶어요.", 90),
    ("QUESTION", "앱스토어 환불 어떻게 신청하나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # PARENT
  # ══════════════════════════════════════════════════════

  "SN_PARENT_LINK_HOW": [  # knowledge: SN_PARENT_LINK_HOW (new), MEDIUM
    ("CANONICAL", "학부모가 자녀와 연결하는 방법은?", 100),
    ("POLITE", "자녀 연결 방법을 알려주세요.", 90),
    ("POLITE", "아이와 계정을 연결하려면 어떻게 하나요?", 90),
    ("CASUAL", "아이 연결하는 방법이 뭐야?", 85),
    ("SHORT", "자녀 연결", 80),
    ("SHORT", "아이 연결 방법", 80),
    ("COMMAND", "자녀 연결 방법 알려줘", 85),
    ("QUESTION", "자녀 연결 시 수영장이 등록되어 있어야 하나요?", 85),
    ("TYPO", "아이 연결하는 방법이 뭐에요", 75),
  ],

  "SN_PARENT_NOT_LINKED": [  # knowledge: ki_cs12_parent_not_linked, MEDIUM
    ("CANONICAL", "학부모 앱에서 자녀 정보가 안 보여요.", 100),
    ("POLITE", "학부모 앱에 아이 정보가 표시되지 않아요.", 90),
    ("POLITE", "자녀 연결이 안 된 것 같아요.", 90),
    ("CASUAL", "아이 정보가 왜 안 보여?", 85),
    ("CASUAL", "자녀 정보가 학부모 앱에 없어요", 85),
    ("SHORT", "자녀 정보 안보임", 80),
    ("SHORT", "자녀 연결 안됨", 80),
    ("QUESTION", "자녀 연결이 안 되는 이유가 뭔가요?", 85),
    ("COMMAND", "자녀 정보 안보이는 이유 알려줘", 85),
    ("TYPO", "아이 정보가 안보여요", 75),
  ],

  "SN_PARENT_MESSAGES_REDIRECT": [  # knowledge: SN_PARENT_MESSAGES_REDIRECT (new), LOW
    ("CANONICAL", "학부모 앱에서 쪽지함이 없어졌어요.", 100),
    ("POLITE", "학부모 앱에서 쪽지 기능이 없어진 건가요?", 90),
    ("POLITE", "쪽지가 어디로 갔나요?", 90),
    ("CASUAL", "쪽지함이 어디 있어?", 85),
    ("SHORT", "쪽지함", 80),
    ("QUESTION", "강사한테 쪽지를 어떻게 보내나요?", 85),
  ],

  "SN_PARENT_SHOPPING_PLACEHOLDER": [  # knowledge: SN_PARENT_SHOPPING_PLACEHOLDER (new), LOW
    ("CANONICAL", "학부모 앱에 쇼핑 메뉴가 있던데 어떤 기능인가요?", 100),
    ("POLITE", "쇼핑 기능은 언제 사용할 수 있나요?", 90),
    ("CASUAL", "쇼핑 메뉴가 뭐야?", 85),
    ("SHORT", "쇼핑 기능", 80),
    ("QUESTION", "쇼핑 준비 중이라고 뜨는데 언제 출시되나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # DEVICE PERMISSION
  # ══════════════════════════════════════════════════════

  "SN_DEVICE_CAMERA_PERMISSION": [  # knowledge: SN_DEVICE_CAMERA_PERMISSION (new), LOW
    ("CANONICAL", "카메라/사진 권한은 어떻게 허용하나요?", 100),
    ("POLITE", "앱에서 카메라 권한을 허용하는 방법을 알려주세요.", 90),
    ("POLITE", "사진 접근 권한 설정 방법이 궁금해요.", 90),
    ("CASUAL", "카메라 권한 어떻게 켜?", 85),
    ("SHORT", "카메라 권한 설정", 80),
    ("QUESTION", "사진 업로드를 하려면 어떤 권한이 필요한가요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # NETWORK / SERVER ERROR
  # ══════════════════════════════════════════════════════

  "SN_APP_ERROR_NETWORK": [  # knowledge: SN_APP_ERROR_NETWORK (new), LOW
    ("CANONICAL", "앱에서 네트워크 오류 또는 연결 시간 초과가 나타나요.", 100),
    ("POLITE", "네트워크 오류가 발생했습니다.", 90),
    ("POLITE", "앱 연결 오류가 계속 납니다.", 90),
    ("CASUAL", "네트워크 오류가 나는데 왜 그래?", 85),
    ("SHORT", "네트워크 오류", 80),
    ("SHORT", "연결 시간 초과", 80),
    ("QUESTION", "와이파이를 켰는데도 연결 오류가 나요. 왜 그런가요?", 85),
  ],

  "SN_APP_ERROR_SERVER": [  # knowledge: ki_cs12_server_error_triage, LOW
    ("CANONICAL", "서버 오류가 발생했어요. 어떻게 해야 하나요?", 100),
    ("POLITE", "서버 오류가 계속 발생합니다.", 90),
    ("POLITE", "앱을 사용 중에 서버 오류 메시지가 떠요.", 90),
    ("CASUAL", "서버 오류가 나는데 어떻게 해?", 85),
    ("SHORT", "서버 오류", 80),
    ("SHORT", "500 오류", 80),
    ("QUESTION", "서버 오류가 계속 날 때 어떻게 해야 하나요?", 85),
  ],

  "SN_APP_ERROR_AI": [  # knowledge: ki_cs12_ai_error_triage, LOW
    ("CANONICAL", "AI 기능 오류가 발생했어요.", 100),
    ("POLITE", "AI 기능에 오류가 발생했습니다.", 90),
    ("POLITE", "AI가 작동하지 않아요.", 90),
    ("CASUAL", "AI 기능이 왜 안 돼?", 85),
    ("SHORT", "AI 오류", 80),
    ("QUESTION", "AI 기능 오류가 계속 발생할 때 어떻게 하나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # DATA
  # ══════════════════════════════════════════════════════

  "SN_DATA_FILTER_ISSUE": [  # knowledge: ki_cs12_data_filter_check, LOW
    ("CANONICAL", "데이터가 보이지 않아요. 필터 때문일 수 있나요?", 100),
    ("POLITE", "화면에 데이터가 보이지 않습니다.", 90),
    ("POLITE", "목록이 비어 있어요. 왜 그런가요?", 90),
    ("CASUAL", "데이터가 왜 안 보여?", 85),
    ("SHORT", "데이터 안보임", 80),
    ("SHORT", "목록이 비어 있음", 80),
    ("QUESTION", "필터 설정 때문에 데이터가 안 보이는 건가요?", 85),
  ],

  "SN_DATA_ROLE_MISMATCH": [  # knowledge: ki_cs12_data_role_mismatch, LOW
    ("CANONICAL", "다른 역할로 로그인했더니 데이터가 안 보여요.", 100),
    ("POLITE", "역할이 달라서 데이터가 보이지 않는 건가요?", 90),
    ("POLITE", "역할에 따라 볼 수 있는 데이터가 다른가요?", 90),
    ("CASUAL", "역할이 달라서 데이터가 안 보이는 거야?", 85),
    ("SHORT", "역할별 데이터 범위", 80),
    ("QUESTION", "왜 강사로 로그인하면 다른 반 데이터가 안 보이나요?", 85),
  ],

  # ══════════════════════════════════════════════════════
  # ADMIN
  # ══════════════════════════════════════════════════════

  "SN_ADMIN_BULK_REGISTER": [  # knowledge: SN_ADMIN_BULK_REGISTER (new), LOW
    ("CANONICAL", "회원을 한번에 등록하는 방법은?", 100),
    ("POLITE", "회원 일괄 등록 방법을 알려주세요.", 90),
    ("POLITE", "여러 명을 한꺼번에 등록하는 방법이 있나요?", 90),
    ("CASUAL", "회원 한번에 등록하는 방법이 뭐야?", 85),
    ("SHORT", "회원 일괄 등록", 80),
    ("SHORT", "명단 한번에 올리기", 80),
    ("COMMAND", "회원 일괄 등록 방법 알려줘", 85),
  ],

  "SN_TEACHER_REVENUE_WHAT": [  # knowledge: SN_TEACHER_REVENUE_WHAT (new), MEDIUM
    ("CANONICAL", "강사 정산 기능은 무엇인가요?", 100),
    ("POLITE", "강사 정산 기능에 대해 알려주세요.", 90),
    ("POLITE", "강사 매출 조회는 어떻게 하나요?", 90),
    ("CASUAL", "강사 정산 기능이 뭐야?", 85),
    ("SHORT", "강사 정산", 80),
    ("SHORT", "정산 기능", 80),
    ("QUESTION", "강사 정산 금액은 어떻게 계산되나요?", 85),
    ("ALIAS", "강사 revenue 기능", 75),
    ("COMMAND", "강사 정산 기능 설명해줘", 85),
  ],

  "SN_ADMIN_WITHDRAWAL_READONLY": [  # knowledge: ki_cs12_pool_admin_withdrawal_deferred, LOW
    ("CANONICAL", "앱 상단에 '읽기 전용' 배너가 떠있어요.", 100),
    ("POLITE", "읽기 전용 모드란 무엇인가요?", 90),
    ("POLITE", "읽기 전용 배너가 표시됩니다. 왜 그런가요?", 90),
    ("CASUAL", "읽기 전용이 뭐야?", 85),
    ("SHORT", "읽기 전용 배너", 80),
    ("QUESTION", "읽기 전용 모드에서는 무엇을 할 수 있나요?", 85),
  ],

}

# ── Main generation ───────────────────────────────────────────────────────────

def load_canonical_answers(path: str):
    with open(path) as f:
        return json.load(f)

def build_utterances(answers, utterances_by_intent):
    # Build lookup: answer_id → {intent_id, knowledge_id, answer_mode}
    answer_lookup = {}
    for a in answers:
        answer_lookup[a["answer_id"]] = a

    results = []
    uid_counter = [0]

    def make_uid():
        uid_counter[0] += 1
        return f"utt_{uid_counter[0]:05d}"

    for answer_id, variants in utterances_by_intent.items():
        if answer_id not in answer_lookup:
            print(f"WARNING: answer_id {answer_id} not in canonical answers", file=sys.stderr)
            continue

        ans = answer_lookup[answer_id]
        intent_id = ans["intent_id"]
        # Use existing ACTIVE ki if available; otherwise use answer_id as knowledge_id
        knowledge_id = ans.get("existing_ki") or answer_id
        answer_mode = ans.get("answer_mode", "DIRECT_DB")

        # Track which ki is used: if new canonical (no existing_ki), these will be pending
        has_active_ki = bool(ans.get("existing_ki"))

        for (variant_type, utterance, weight) in variants:
            normed = normalize_query(utterance)
            status = "candidate"  # all start as candidate; active after QA

            results.append({
                "utterance_id": make_uid(),
                "intent_id": intent_id,
                "knowledge_id": knowledge_id,
                "utterance": utterance,
                "normalized_utterance": normed,
                "language": "ko",
                "weight": weight,
                "status": status,
                "variant_type": variant_type,
                "answer_mode": answer_mode,
                "has_active_ki": has_active_ki,
                "_answer_id": answer_id,  # for QA only, not imported
            })

    return results

def qa_utterances(utterances):
    errors = []
    warnings = []

    # Exact duplicates
    exact = {}
    for u in utterances:
        key = u["utterance"].strip().lower()
        if key in exact:
            errors.append(f"DUPLICATE_EXACT: '{u['utterance']}' ({u['_answer_id']} vs {exact[key]})")
        else:
            exact[key] = u["_answer_id"]

    # Normalized duplicates within same intent
    norm_by_intent = {}
    for u in utterances:
        key = (u["intent_id"], u["normalized_utterance"])
        if key in norm_by_intent:
            warnings.append(f"DUPLICATE_NORMALIZED_SAME_INTENT: '{u['utterance']}' in {u['intent_id']}")
        else:
            norm_by_intent[key] = u["utterance"]

    # Cross-intent normalized collision (same normalized, different intent)
    norm_all = {}
    for u in utterances:
        n = u["normalized_utterance"]
        if n not in norm_all:
            norm_all[n] = []
        norm_all[n].append(u["intent_id"])

    cross_collisions = []
    for n, intents in norm_all.items():
        unique_intents = list(set(intents))
        if len(unique_intents) > 1:
            cross_collisions.append(f"CROSS_INTENT_COLLISION: '{n}' → {unique_intents}")

    # Circular fallback check
    circular_patterns = ["고객지원으로 문의해 주세요", "고객센터에 문의해 주세요", "support 팀에 문의"]
    for u in utterances:
        for p in circular_patterns:
            if p in u["utterance"]:
                errors.append(f"CIRCULAR_FALLBACK in utterance: '{u['utterance']}'")

    # HUMAN_ONLY check: HUMAN_ONLY answers must not return DIRECT_DB
    for u in utterances:
        if u["answer_mode"] == "HUMAN_ONLY" and u["status"] == "active":
            errors.append(f"HUMAN_ONLY_AUTO_ACTIVE: {u['utterance_id']} {u['intent_id']}")

    # Unsupported policy check in utterances
    policy_danger = ["가격은", "요금은", "비용은", "환불", "약정"]
    for u in utterances:
        if u["answer_mode"] == "DIRECT_DB":
            for p in policy_danger:
                if p in u["utterance"] and "얼마" in u["utterance"]:
                    warnings.append(f"POLICY_IN_DIRECT_DB_UTTERANCE: '{u['utterance']}' (intent: {u['intent_id']})")

    return errors, warnings, cross_collisions

def main():
    answers_path = "artifacts/api-server/src/content/support-canonical-answers.json"
    output_path = "artifacts/api-server/src/content/support-intent-utterances.json"

    answers = load_canonical_answers(answers_path)
    utterances = build_utterances(answers, UTTERANCES_BY_INTENT)

    errors, warnings, collisions = qa_utterances(utterances)

    print(f"\n=== UTTERANCE GENERATION QA ===")
    print(f"TOTAL_UTTERANCES: {len(utterances)}")
    print(f"INTENTS_COVERED: {len(UTTERANCES_BY_INTENT)}")

    by_type = {}
    for u in utterances:
        by_type[u["variant_type"]] = by_type.get(u["variant_type"], 0) + 1
    print("\nBY_VARIANT_TYPE:")
    for t, c in sorted(by_type.items()):
        print(f"  {t}: {c}")

    has_active_ki = sum(1 for u in utterances if u.get("has_active_ki"))
    new_canonical = sum(1 for u in utterances if not u.get("has_active_ki"))
    human_only = sum(1 for u in utterances if u["answer_mode"] == "HUMAN_ONLY")

    print(f"\nHAS_ACTIVE_KI (importable): {has_active_ki}")
    print(f"NEW_CANONICAL (pending_until_approval): {new_canonical}")
    print(f"HUMAN_ONLY_UTTERANCES: {human_only}")

    print(f"\nERRORS: {len(errors)}")
    for e in errors:
        print(f"  ERROR: {e}")

    print(f"\nWARNINGS: {len(warnings)}")
    for w in warnings[:10]:
        print(f"  WARN: {w}")

    print(f"\nCROSS_INTENT_COLLISIONS: {len(collisions)}")
    for c in collisions[:10]:
        print(f"  COLLISION: {c}")

    # Remove internal QA fields before writing
    clean = []
    for u in utterances:
        row = {k: v for k, v in u.items() if not k.startswith("_") and k not in ("answer_mode", "has_active_ki")}
        clean.append(row)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, indent=2)

    print(f"\nWROTE: {output_path} ({len(clean)} utterances)")
    return 0 if not errors else 1

if __name__ == "__main__":
    sys.exit(main())
