# 데이터 모델 스키마 — Agent A 초안

## 핵심 설계 결정 (3~5줄)
- **단일 PostgreSQL + Row Level Security**(가족 그룹 ID 기준)로 멀티테넌시를 표현하고, 모든 도메인 엔티티에 `family_group_id`를 비정규화하여 권한·인덱스·동기화 비용을 줄인다.
- **모든 사용자 입력 엔티티(`FeedingLog`/`SleepLog`/`DiaperLog`/`Photo` 등)는 공통 베이스(`id, family_group_id, baby_id, recorded_at, created_at, updated_at, deleted_at, version, source, created_by, client_event_id`)** 를 따라 오프라인 큐 → 멱등 동기화와 감사 추적을 한 번에 해결한다.
- **LLM 호출 결과는 별도 `LLMInvocation` 테이블로 분리**하여 어떤 프로바이더/모델/오프라인 여부/토큰/지연/캐시 히트인지 기록하고, `CryAnalysis`·`AITip`·`CryPattern`이 이를 FK로 참조한다 (재현·비용·재분석 트리거 가능).
- **음성비서 출처는 `source` enum**(`MANUAL_UI`, `VOICE_SIRI`, `VOICE_GOOGLE`, `VOICE_BIXBY`, `QUICK_REPEAT`, `IMPORTED`, `AI_INFERRED`)으로 모든 입력 엔티티에 통일 저장하고, 음성 발화 원본은 `VoiceUtterance`로 1:1 연결한다.
- **충돌 해결은 LWW(Last-Write-Wins) per field + 사용자별 `version` vector**, 사진/마일스톤은 append-only로 충돌이 발생하지 않게 모델링하며, 사진 본문은 **클라이언트 측 AES-256-GCM E2E 암호화**(서버는 암호문 + IV + DEK-Wrap만 저장).

> 본 초안은 별도 첨부 파일에 전체 엔티티 상세를 보관. 비판 라운드용 요약.

핵심 엔티티: UserAccount, UserDevice, FamilyGroup, Membership, Invitation, Baby, BabyGuardian, FeedingLog, SleepLog, DiaperLog, LogShareSnapshot, VoiceUtterance, CryAnalysis, CryCandidate, CryAudioClip, CryFeedback, CryPattern, Photo, Album, AlbumPhoto, Milestone, PhotoReaction, GrowthMeasurement, Vaccination, AITip, AITipFeedback, AIProviderConfig, BYOKKey, LLMInvocation, LLMResponseCache, OfflineQueueItem, SyncConflict, NotificationDelivery, ConsentRecord, AuditEvent.

특징 요약:
- ID: **UUIDv7** 통일, 클라이언트 발급 + 멱등키 `client_event_id`
- 충돌: 일지류 LWW per field + `SyncConflict` row → 사용자 선택; append-only 엔티티는 충돌 무
- E2E: Photo(본문+캡션+썸네일+EXIF). 가족그룹 키 → 멤버 디바이스 공개키 래핑
- LLM: `LLMInvocation`이 폴리모픽 부모. `purpose`/`provider`/`offline_mode`/`auth_mode`/`fallback_from_invocation_id`/`cache_hit` 추적
- 권한: `Membership.role`(ADMIN/GUARDIAN/VIEWER) — VIEWER도 사진 업로드 가능

Open Questions (15개):
1. Photo↔Baby 다중 표현 (UUID[] vs 정규화 매핑 테이블)
2. Milestone 마스터/인스턴스 분리 형태
3. AIProviderConfig 단위 (가족 vs 사용자)
4. 진행 중 수면 (`woke_up_at` NULL) 멱등성
5. CryAudioClip 단기 보관 시 익명화 정책
6. WHO 성장 곡선 마스터 데이터 버전 관리
7. 운영사 키 한도 단위 (가족/사용자/글로벌)
8. 다국어 마일스톤·팁 i18n 테이블화
9. 사진 EXIF GPS 사용자 옵션
10. VIEWER 사진 업로드 후 본인 삭제 권한
11. 잊혀질 권리 (외부 LLM 데이터 삭제 요청)
12. 디바이스 시계 skew 처리
13. 영상 트랜스코딩 산출물 모델링
14. CryFeedback 자유 라벨링
15. 다중 지역 예방접종 일정 마스터
