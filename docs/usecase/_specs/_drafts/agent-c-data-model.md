# 데이터 모델 스키마 — Agent C 초안

## 핵심 설계 결정 (3~5줄)
- **하이브리드 ID**: 모든 엔티티는 클라이언트 생성 **ULID(`id`) + 서버 단조증가 `server_seq`(BigInt)** 동시 보유. ULID로 오프라인 생성, `server_seq`로 동기화·페이지네이션·정렬.
- **소프트삭제 + 동기화 메타 표준화**: SyncableEntity 공통(`created_at, updated_at, deleted_at, version, last_edited_by, device_id, origin_source, origin_invocation_id`). LWW 기본, **수면/수유 시간 구간 ±15분 겹침은 수동 머지 후보로 큐잉**.
- **가족 그룹 = 권한·격리 단위**, 추가로 **BabyAccessGrant**로 베이비시터의 특정 아기 한정 부분 ACL 표현.
- **사진은 메타만 동기화, 본체는 E2E**. `Photo` 메타 + `MediaAsset`(객체 스토리지 인덱스) + `PhotoKeyWrap`(가족 DEK를 디바이스 공개키로 래핑) 3계층.
- **AIInference = 1급 시민** (폴리모픽). 모든 LLM 호출(울음분석/AI팁/패턴/음성 파싱/마일스톤 자동 태깅)의 메타·비용·동의 스냅샷.

> 본 초안은 별도 첨부 파일에 전체 엔티티 상세 보관. 비판 라운드용 요약.

핵심 엔티티: User, AuthIdentity, Device, UserPreference, ConsentRecord, FamilyGroup, Membership, Invitation, BabyAccessGrant, Baby, BabyMedicalNote, FeedingLog, SleepLog, DiaperLog, LogEditHistory, CryAnalysisSession, CryAnalysisResult, CryFeedback, CryPatternInsight, Photo, PhotoKeyWrap, Album, AlbumItem, MilestoneTag, GrowthMeasurement, Vaccination, AITip, AITipFeedback, AIProviderConfig, AIInference, AIInferenceMetric, OfflineQueueItem, SyncCheckpoint, AuditEvent, NotificationDispatch, VoiceInvocation, MediaAsset.

특징 요약 (A·B안과의 차이 위주):
- **ULID + server_seq** 하이브리드 (A: UUIDv7 단일, B: UUIDv7 단일과 유사)
- **BabyAccessGrant** — 베이비시터 부분 ACL을 데이터 모델 차원에서 지원 (A·B 없음)
- **BabyMedicalNote** 분리 — 알러지/기저질환을 별도 암호화 컬럼 엔티티로 격리
- **MediaAsset** — 사진 메타와 객체 스토리지 인덱스 분리 (사진/오디오/프로필 사진 통합 관리)
- **PhotoKeyWrap** — 가족 DEK + dek_version + wrapped_for_device_id (디바이스 단위 래핑, 키 회전 명시)
- **LogEditHistory** — 일지 수정 이력을 별도 테이블에 명시 보관
- **AIInferenceMetric** — 시간 버킷 집계 테이블 (B의 LLMUsageQuota와 유사하지만 더 일반화)
- **NotificationDispatch** — 송신 기록 + 조용한 시간(quiet_hours) 처리
- **CryAnalysisSession ↔ CryAnalysisResult 1:N** — 같은 녹음을 여러 프로바이더로 재분석 가능 (`is_reanalysis_of`)
- **fractional indexing (Decimal position)** for AlbumItem 사용자 재정렬
- **충돌 정책**: 시간 구간 ±15분 겹침은 자동 머지 시도(긴 구간 우선) → 실패 시 CONFLICT_MANUAL_REVIEW
- **상태 명시**: 큐 아이템에 `state: PENDING/IN_FLIGHT/FAILED/CONFLICT_MANUAL_REVIEW/SUCCEEDED`

Open Questions (18개):
1. 다중 가족 그룹 동시 가입 허용 (가정: 허용)
2. 쌍둥이/형제 같은 그룹 vs 별 그룹
3. 이혼/별거 그룹 split/merge 워크플로
4. WHO 곡선 계산 위치
5. 마일스톤과 사진 M:N (현재 1:1 + Album 경유)
6. 음성 지문 저장 위치 (서버 vs 디바이스)
7. Gemma 4 모델 파일 버저닝
8. Cry audio retention 기본값 (현재 DISCARD_IMMEDIATE)
9. 마지막 ADMIN 탈퇴 시 그룹 처리
10. 이유식 알러지 자동 경고 매칭 위치
11. EXIF GPS 가족 동의 옵션
12. AI Tip 다국어 재생성 정책
13. Billing party 별 한도 추적 테이블 필요성
14. 진행 중 수면 운영상 허용 여부
15. 회원 탈퇴 시 작성 데이터 익명화
16. CryAnalysisResult label_code vs label_freeform 병기
17. 사진 댓글/좋아요 (PhotoReaction)
18. 24개월 초과 자동 아카이브 정책
