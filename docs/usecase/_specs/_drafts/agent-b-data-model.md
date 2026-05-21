# 데이터 모델 스키마 — Agent B 초안

## 핵심 설계 결정 (3~5줄)

1. **가족 그룹(FamilyGroup)을 최상위 테넌트로 둔다.** 사용자(User)는 여러 그룹에 속할 수 있고, 모든 도메인 레코드는 `family_group_id`를 외래키로 가진다. 권한은 `Membership.role`(admin/caregiver/viewer)에 종속되며 RLS 정책의 근거가 된다.
2. **입력 출처(InputSource)를 모든 일지 레코드에 공통 컬럼으로 강제한다.** `manual` / `quick_repeat` / `voice_siri` / `voice_google` / `voice_bixby` / `ai_suggested` / `imported` 등 enum + `source_confidence` + `source_raw_text`로 음성비서 추적성 보장.
3. **LLM 호출은 별도 `LLMInvocation` 엔티티로 1차 시민화.** CryAnalysis, AITip, CryPattern, VoiceIntentLog 등 모든 LLM 결과가 `llm_invocation_id`로 호출 기록을 역참조. "오프라인 → 온라인 재분석" 흐름과 메트릭이 단일 진실 원천.
4. **오프라인 큐는 디바이스 로컬 테이블**, 충돌은 "쓰기 LWW + 사용자 의도 우선 + 동일 카테고리/시각±5분/동일 작성자 머지 후보 제안"의 2단계. `client_op_id`(UUIDv7) 멱등키로 재전송 안전.
5. **사진·캡션·EXIF는 E2E 암호화 대상**, 일지/울음 분석은 TLS + 저장구간 서버 측 암호화. E2E 대상은 `e2ee_envelope_id`로 키 봉투 참조, 평문 메타는 최소화.

> 본 초안은 별도 첨부 파일에 전체 엔티티 상세 보관. 비판 라운드용 요약.

핵심 엔티티: User, AuthIdentity, Device, FamilyGroup, Membership, Invitation, Baby, BabyCaregiverLink, FeedingLog, SleepLog, DiaperLog, LogShareEvent, CryAudioClip, CryAnalysis, CryCause, CryFeedback, CryPattern, Photo, Album, AlbumItem, Milestone, PhotoMilestoneTag, MemoryCard, GrowthMeasurement, Vaccination, AITip, AITipFeedback, AIProviderConfig, AIProviderCredential, LLMInvocation, LLMUsageQuota, VoiceAssistantBinding, VoiceIntentLog, OfflineQueueItem, SyncCursor, NotificationPreference, ConsentRecord, E2EEKeyEnvelope, AuditEvent, SoftDeleteTombstone.

특징 요약 (A안과의 차이 위주):
- AIProviderConfig가 **scope=family_group | user** 두 단위 모두 가능 (개인 오버라이드 허용)
- AIProviderCredential은 항상 **개인 소유** (가족 공유 금지) + `device_id` FK로 어느 디바이스 키체인인지
- LLMUsageQuota 별도 테이블 (월 단위 + 가족/사용자 둘 다)
- VoiceAssistantBinding (등록) + VoiceIntentLog (호출 이력) 두 테이블 분리
- MemoryCard 명시적 캐시 테이블 ("1년 전 오늘" 등)
- SoftDeleteTombstone 별도 비석 테이블 (다중 디바이스 전파용)
- DiaperLog.anomaly_flag (서버 룰엔진이 채움)
- Photo.local_date (가족 기본 TZ 비정규화)
- LLMInvocation에 `parent_invocation_id` (폴백 체인)
- 충돌 해결 시 InputSource 우선순위: manual > voice > ai_suggested > imported

Open Questions (15개):
1. 다중 가족 그룹의 active 컨텍스트 (Device/Binding에 active_family_group_id?)
2. FamilyGroup 단위 TZ 필요 여부
3. 한 아기를 두 가족 그룹이 공유하는 케이스
4. 녹음 단기 보관 기간 (잠정 30일)
5. CryCause 표준 코드셋 (6종 + 의학 자문 확장)
6. E2E 키 회전 트리거 (즉시 vs lazy)
7. PDF 외부 공유 시 E2E 우회 처리·블러
8. LLMUsageQuota 한도 단위
9. Gemini OAuth 구독 상태 동기화 주기
10. 음성 화자 인증 등록 모달
11. AITip 응급 키워드 룰 소스
12. Photo 다중 아기 표현
13. 도메인별 보존 기한 분리
14. viewer 권한의 마일스톤 태깅 범위
15. WHO 백분위 계산 위치 (서버/클라이언트)
