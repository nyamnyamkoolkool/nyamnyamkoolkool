# 데이터 모델 스키마 (합의안)

> 냠냠쿨쿨 v1 데이터 모델 합의안.
> 작성: 2026-05-20 (Agent A/B/C 독립 초안 → Critic A/B/C 상호 비판 → 사용자 결정으로 합의)
> 상위: [main-scenario.md](../main-scenario.md)

본 문서는 백엔드(서버 DB)와 모바일 클라이언트(SQLite/Realm) 양측에서 호환되는 도메인 모델의 단일 진실 원천이다.

---

## 1. 합의 결정 매트릭스

| 결정 항목 | 합의 | 사유 / 합의 방식 |
|---|---|---|
| ID 체계 | **UUIDv7 단일 PK** (클라이언트 발급) + **`server_seq` BigInt 보조 컬럼** (서버 측 가족 단위 시퀀스) + `client_event_id` 멱등키 | A·C 합의. ULID PK는 C가 자기비판 후퇴. server_seq는 PK가 아닌 보조로 페이지네이션·증분 동기화에만 사용 |
| 권한 모델 | **`Membership.role`(ADMIN/GUARDIAN/VIEWER)** + **`BabyAccessGrant`(per-baby ACL, v1 채택)** | 사용자 결정: 베이비시터·이혼·공동양육 시나리오 대응 |
| VIEWER 사진 업로드 | **허용** (UC-3.2 명문대로) | 사용자 결정 |
| 충돌 해결 | **LWW per field** + **도메인별 시간 윈도우 머지 후보 제안** + **사용자 승인 게이트** (자동 머지 금지) | A·C 합의: 자동 머지의 데이터 손실 위험 회피 |
| 시간 윈도우 (머지 후보) | 수유 ±2분 / 수면 ±20분 / 배변 ±3분 / 사진 ±60초 | A 권장 (도메인별 상수) |
| 음성비서 출처 추적 | `origin_source` enum + `source_raw_text` + `source_confidence` + (LLM 개입 시) `origin_invocation_id` + `VoiceAssistantBinding`/`VoiceInvocation` 분리 | 3안 하이브리드 |
| LLM 호출 추적 | `LLMInvocation` 단일 폴리모픽 + `relation_kind` enum(`RETRY/FALLBACK/REANALYSIS/CACHE_HIT`) + `LLMUsageQuota` 별도 + 울음 분석만 `CryAnalysisSession ↔ Result 1:N` | A·B·C 하이브리드 |
| E2E 키 관리 | 3계층: `Photo` 메타 + `MediaAsset` 객체 인덱스 + `PhotoKeyWrap`(`dek_version` + `wrapped_for_device_id`) | C 채택 |
| E2E 대상 범위 | 사진 본문 + 캡션 + 썸네일 + EXIF + `BabyMedicalNote` payload | A·C 결합 |
| Photo↔Baby 다중 | 정규화 매핑 테이블 **`PhotoBabyTag`** | 만장일치 |
| AIProviderConfig 단위 | **`scope = family_group | user`** 이중 | 만장일치 (B 채택) |
| BYOK 키 보관 | 항상 **개인 소유 + `device_id` FK** + 디바이스 키체인 only. 토스 채널에서는 `storage_kind = NOT_ALLOWED` | B 채택 + 앱인토스 적용 |
| 오프라인 큐 위치 | **디바이스 로컬 SQLite SoT**, 서버는 `client_event_id`로 멱등 수신만 (서버 미러 X) | A 채택 (운영 비용·프라이버시) |
| 큐 상태머신 | `PENDING / IN_FLIGHT / FAILED / CONFLICT_MANUAL_REVIEW / SUCCEEDED` | C 채택 |
| Soft delete | `deleted_at` 컬럼 + 동기화 페이로드에서 tombstone 시그널로 압축 (별도 테이블 X) | A 채택 |
| 새 멤버 추가 시 DEK 재래핑 | **즉시 일괄 rewrap 워크플로 명시** | 만장일치 보강 |
| Subscription/Payment | **v1 신설** — 앱인토스 IAP 즉시 필요 | 사용자 결정 |
| Cry audio 보관 | **즉시 폐기 기본** + 사용자 동의 시 30일 보관 | 사용자 결정 |
| BabyMedicalNote | 별도 암호화 엔티티 분리 | C 채택 (민감정보 격리) |
| 앱인토스 채널 반영 | `AuthIdentity.provider` 확장 + `Device.platform` 확장 + `Device.app_channel` + `Device.capabilities` JSONB + `LLMInvocation.app_channel` + `AIProviderConfig.requires_*` 플래그 + `NotificationDispatch.delivery_channel` | 3안 통합 |

---

## 2. 공통 패턴 (SyncableEntity 공통 베이스)

모든 동기 대상 도메인 엔티티는 다음 공통 컬럼을 갖는다.

```
SyncableEntity (베이스):
  id                   UUIDv7        PK, 클라이언트 발급
  server_seq           BigInt        서버 부여 (가족 단위 단조증가, 보조 인덱스)
  family_group_id      UUIDv7        FK → FamilyGroup (RLS 키, 비정규화)
  baby_id              UUIDv7?       FK → Baby (entity에 따라 nullable)
  created_at           TIMESTAMPTZ   서버 부여, UTC
  updated_at           TIMESTAMPTZ   서버 부여, LWW 비교 기준
  deleted_at           TIMESTAMPTZ?  소프트 삭제
  version              INT           optimistic concurrency
  last_edited_by       UUID          FK → User
  origin_device_id     UUID          FK → Device
  origin_source        ENUM          InputSource (아래 참조)
  origin_invocation_id UUID?         FK → LLMInvocation (음성/AI 추론 시)
  source_raw_text      TEXT?         음성 원문 (저장 동의 시)
  source_confidence    DECIMAL(3,2)? 음성/AI 파싱 신뢰도
  client_event_id      UUID          멱등키 (UNIQUE)
  app_channel          ENUM          NATIVE_IOS | NATIVE_ANDROID | TOSS_MINIAPP
```

### InputSource enum
`MANUAL_UI` / `QUICK_REPEAT` / `VOICE_SIRI` / `VOICE_GOOGLE` / `VOICE_BIXBY` / `TOSS_MINIAPP_MANUAL` / `AI_SUGGESTED` / `AI_INFERRED` / `IMPORTED` / `SYSTEM`

### 인덱스 표준 (공통 베이스)
- `(family_group_id, server_seq)` — 증분 동기화 핵심
- `(family_group_id, baby_id, [domain_time] DESC)` — 타임라인 뷰
- `(family_group_id, deleted_at)` — 활성 데이터 필터
- UNIQUE `(client_event_id)` — 멱등성

---

## 3. 엔티티 목록 (총 36개)

### 계정·세션
| # | 엔티티 | 책임 |
|---|---|---|
| 1 | `User` | 사용자 정체성 |
| 2 | `AuthIdentity` | OAuth/패스키 등 외부 인증 (TOSS_OAUTH 포함) |
| 3 | `Device` | 디바이스 + 푸시 토큰 + 공개키 + capabilities |
| 4 | `UserPreference` | 알림·언어·접근성 |
| 5 | `ConsentRecord` | LLM 전송·오디오 보관·결제 등 동의 이력 |
| 6 | `Session` | 채널/디바이스별 활성 세션 (앱인토스 ↔ 네이티브 라우팅용) |

### 가족·권한
| # | 엔티티 | 책임 |
|---|---|---|
| 7 | `FamilyGroup` | 멀티테넌시 루트 |
| 8 | `Membership` | User ↔ FamilyGroup 역할 매핑 |
| 9 | `Invitation` | 단일 사용 초대 토큰 |
| 10 | `BabyAccessGrant` | 멤버를 특정 아기 한정·시간 제한 ACL |
| 11 | `AuditEvent` | 권한·키·삭제 등 보안 감사 |

### 아기·일지
| # | 엔티티 | 책임 |
|---|---|---|
| 12 | `Baby` | 아기 프로필 (legal_name은 암호화 컬럼) |
| 13 | `BabyMedicalNote` | 알러지·기저질환 (E2E 암호화 payload) |
| 14 | `BabyGuardian` | 아기 ↔ 보호자 관계(엄마/아빠/조부모/시터) |
| 15 | `FeedingLog` | 수유 기록 |
| 16 | `SleepLog` | 수면 기록 |
| 17 | `DiaperLog` | 배변 기록 |
| 18 | `LogShareSnapshot` | 일지 PDF/이미지 내보내기 |

### 음성비서
| # | 엔티티 | 책임 |
|---|---|---|
| 19 | `VoiceAssistantBinding` | Siri/Google/Bixby 등록 메타 |
| 20 | `VoiceInvocation` | 음성 호출 단건 (원문 + 파싱 슬롯) |

### 울음 분석
| # | 엔티티 | 책임 |
|---|---|---|
| 21 | `CryAnalysisSession` | 1회 녹음 + 컨텍스트 스냅샷 |
| 22 | `CryAnalysisResult` | LLM 결과 (Session 1:N — 재분석 누적) |
| 23 | `CryCandidate` | 1~3순위 원인 후보 |
| 24 | `CryFeedback` | 사용자 라벨링·후속 행동 |
| 25 | `CryPatternInsight` | 누적 패턴 인사이트 |

### 사진·갤러리
| # | 엔티티 | 책임 |
|---|---|---|
| 26 | `Photo` | 사진 메타 (E2E) |
| 27 | `PhotoBabyTag` | 사진 ↔ 아기 다대다 |
| 28 | `MediaAsset` | 객체 스토리지 인덱스 (사진/오디오/PDF 통합) |
| 29 | `PhotoKeyWrap` | 가족 DEK × 디바이스 공개키 래핑 (dek_version 명시) |
| 30 | `Album` | 자동/수동 앨범 |
| 31 | `AlbumItem` | Album ↔ Photo |
| 32 | `Milestone` | 마일스톤 (마스터 + 인스턴스) |
| 33 | `MemoryCard` | "1년 전 오늘" 등 캐시 |

### 성장·AI
| # | 엔티티 | 책임 |
|---|---|---|
| 34 | `GrowthMeasurement` | 체중/신장/머리둘레 |
| 35 | `Vaccination` | 예방접종 일정·실시 |
| 36 | `AITip` | 홈 카드 AI 팁 |
| 37 | `AITipFeedback` | 팁 평가 |

### LLM 인프라
| # | 엔티티 | 책임 |
|---|---|---|
| 38 | `AIProviderConfig` | 활성 프로바이더 (scope=family|user) |
| 39 | `AIProviderCredential` | BYOK 키 메타 (디바이스 키체인 alias) |
| 40 | `LLMInvocation` | 모든 LLM 호출 단일 추적 (`relation_kind`로 폴백/재분석 구분) |
| 41 | `LLMUsageQuota` | 운영사 키 한도 추적 (사용자/가족 이중) |
| 42 | `LLMResponseCache` | 컨텍스트 해시 캐시 |

### 결제·구독 (v1 신설)
| # | 엔티티 | 책임 |
|---|---|---|
| 43 | `Subscription` | 가족/사용자 구독 (App Store/Play/Toss IAP/Gemini OAuth 통합) |
| 44 | `PaymentReceipt` | 채널별 영수증 |
| 45 | `BillingChannel` | 결제 채널 마스터 |

### 동기화·운영
| # | 엔티티 | 책임 |
|---|---|---|
| 46 | `SyncCheckpoint` | 디바이스별 last_server_seq |
| 47 | `SyncConflict` / `MergeProposal` | 충돌·머지 후보 |
| 48 | `NotificationDispatch` | 푸시 발송 이력 (channel_kind 분기) |

---

## 4. 핵심 엔티티 상세

> 분량 제약으로 v1 핵심 엔티티(20개)만 상세 명세. 나머지는 후속 PR에서 보강.

### 4.1 User
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `display_name` | VARCHAR(60) | Y | |
| `email` | VARCHAR(254) | N | UNIQUE (소프트 unique) |
| `phone_e164` | VARCHAR(20) | N | UNIQUE |
| `locale` | VARCHAR(10) | Y | 기본 `ko-KR` |
| `timezone` | VARCHAR(40) | Y | IANA, 기본 `Asia/Seoul` |
| `large_text_mode` | BOOL | Y | 조부모 접근성 |
| `active_family_group_id` | UUID | N | 다중 그룹 가입 시 활성 그룹 |
| `voice_speaker_print_id` | UUID | N | v2 화자 인증 |
| `status` | ENUM | Y | `ACTIVE/SUSPENDED/DELETED` |
| 공통 베이스 | | Y | (created_at/updated_at/deleted_at 등) |

### 4.2 AuthIdentity
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `user_id` | UUID | Y | FK |
| `provider` | ENUM | Y | `APPLE` / `GOOGLE` / `KAKAO` / **`TOSS_OAUTH`** / `EMAIL_PASSWORD` / `PASSKEY` |
| `provider_subject` | VARCHAR(255) | Y | 외부 sub |
| `linked_at` | TIMESTAMPTZ | Y | |
| `last_used_at` | TIMESTAMPTZ | N | |
| `last_used_channel` | ENUM | N | 채널 분석용 |

UNIQUE `(provider, provider_subject)`. 한 User에 여러 AuthIdentity 연결 허용(채널 전환 정책).

### 4.3 Device
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `user_id` | UUID | Y | FK |
| `platform` | ENUM | Y | `IOS_NATIVE` / `ANDROID_NATIVE` / **`TOSS_MINIAPP`** / `WEB` |
| `app_channel` | ENUM | Y | `NATIVE_APPSTORE` / `NATIVE_PLAY` / `TOSS_MINIAPP` |
| `os_version` | VARCHAR(20) | N | |
| `app_version` | VARCHAR(20) | Y | |
| `push_token` | TEXT | N | APNs/FCM/토스 푸시 토큰 |
| `voice_assistant` | ENUM | N | `SIRI/GOOGLE/BIXBY/NONE` |
| `public_key` | BYTEA | Y | X25519 공개키 (E2E rewrap용) |
| `key_fingerprint` | VARCHAR(64) | Y | 사람 확인 가능 fingerprint |
| `capabilities` | JSONB | Y | `{supports_voice_assistant, supports_on_device_llm, supports_background_push, supports_secure_keystore, supports_in_app_purchase_provider}` |
| `gemma4_model_version` | VARCHAR(20) | N | 다운로드 완료 시 |
| `last_seen_at` | TIMESTAMPTZ | Y | |
| `revoked_at` | TIMESTAMPTZ | N | 분실·로그아웃 → DEK rewrap 트리거 |

**capabilities 기본값 (채널별)**
| 항목 | NATIVE | TOSS_MINIAPP |
|---|---|---|
| `supports_voice_assistant` | true | **false** |
| `supports_on_device_llm` | true | **false** |
| `supports_background_push` | true | 정책 의존 (보수적 false) |
| `supports_secure_keystore` | true | **false** → BYOK 입력 차단 |

### 4.4 FamilyGroup
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK, 모든 도메인 엔티티의 테넌트 키 |
| `name` | VARCHAR(60) | Y | |
| `owner_user_id` | UUID | Y | FK (생성자/관리자, 위임 가능) |
| `primary_baby_id` | UUID | N | UI 기본 표시 |
| `default_timezone` | VARCHAR(40) | Y | 달력 뷰 기준 |
| `active_dek_id` | UUID | Y | 현재 활성 DEK 버전 |
| 공통 베이스 | | Y | |

### 4.5 Membership
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | FK |
| `user_id` | UUID | Y | FK |
| `role` | ENUM | Y | `ADMIN` / `GUARDIAN` / `VIEWER` |
| `nickname` | VARCHAR(30) | N | "엄마"/"외할머니" |
| `joined_via_invitation_id` | UUID | N | |
| `wrapped_group_key` | BYTEA | Y | 그룹 키를 멤버 공개키로 래핑 |
| `joined_at` | TIMESTAMPTZ | Y | |
| `left_at` | TIMESTAMPTZ | N | |

UNIQUE `(family_group_id, user_id) WHERE left_at IS NULL`.

**권한 매트릭스**
| 동작 | ADMIN | GUARDIAN | VIEWER |
|---|---|---|---|
| 일지 작성 | ✓ | ✓ | ✗ |
| 일지 수정 (본인) | ✓ | ✓ | ✗ |
| 일지 수정 (타인) | ✓ | ✗ | ✗ |
| 일지 삭제 (본인) | ✓ | ✓ | ✗ |
| 일지 삭제 (타인) | ✓ | ✗ | ✗ |
| **사진 업로드** | ✓ | ✓ | **✓** (사용자 결정) |
| 사진 삭제 (본인 업로드) | ✓ | ✓ | ✓ |
| 사진 삭제 (타인 업로드) | ✓ | ✗ | ✗ |
| 마일스톤 태깅 | ✓ | ✓ | ✗ |
| 멤버 초대/권한 변경 | ✓ | ✗ | ✗ |
| AIProviderConfig 변경 (가족 단위) | ✓ | ✗ | ✗ |
| Subscription 결제 | ✓ | ✗ | ✗ |
| 울음 분석 실행 | ✓ | ✓ | ✓ |
| 성장·접종 기록 | ✓ | ✓ | ✗ |

### 4.6 BabyAccessGrant (v1 채택)
멤버십을 특정 아기 한정 + 시간 제한으로 좁히는 부분 ACL.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `membership_id` | UUID | Y | FK |
| `baby_id` | UUID | Y | FK |
| `effective_role` | ENUM | Y | `GUARDIAN/VIEWER` (ADMIN은 그룹 단위만) |
| `valid_from` | TIMESTAMPTZ | Y | |
| `valid_until` | TIMESTAMPTZ | N | NULL이면 무기한 |
| `granted_by_user_id` | UUID | Y | ADMIN |

UNIQUE `(membership_id, baby_id)`.

**RLS 정책 (Postgres)**
```sql
USING (
  family_group_id IN (SELECT family_group_id FROM active_memberships WHERE user_id = current_user_id())
  AND (
    -- 그룹 전체 권한
    EXISTS (SELECT 1 FROM Membership WHERE family_group_id = row.family_group_id AND user_id = current_user_id() AND left_at IS NULL)
    OR
    -- 또는 특정 아기 한정 권한
    EXISTS (SELECT 1 FROM BabyAccessGrant g JOIN Membership m ON m.id = g.membership_id
            WHERE g.baby_id = row.baby_id AND m.user_id = current_user_id()
              AND (g.valid_until IS NULL OR g.valid_until > now()))
  )
)
```

### 4.7 Baby
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | FK |
| `legal_name_ciphertext` | BYTEA | N | E2E 암호화 (가족 DEK) |
| `legal_name_nonce` | BYTEA | N | |
| `display_name` | VARCHAR(40) | Y | 태명/별칭 |
| `pseudonym_token` | VARCHAR(40) | Y | LLM 프롬프트용 가명 |
| `sex` | ENUM | Y | `FEMALE/MALE/UNSPECIFIED` |
| `birth_date` | DATE | Y | |
| `birth_time` | TIME | N | |
| `gestational_weeks` | INT | N | 조산 판정 |
| `preterm` | BOOL | Y | derived (`gestational_weeks < 37`) |
| `birth_weight_g` | INT | N | |
| `birth_height_mm` | INT | N | |
| `profile_photo_id` | UUID | N | FK → Photo |
| `archived_at` | TIMESTAMPTZ | N | |
| 공통 베이스 | | Y | |

### 4.8 BabyMedicalNote (C 채택)
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `baby_id` | UUID | Y | FK |
| `category` | ENUM | Y | `ALLERGY/CHRONIC/MEDICATION/NOTE` |
| `payload_ciphertext` | BYTEA | Y | E2E 암호화 (라벨 + 자유텍스트) |
| `payload_nonce` | BYTEA | Y | |
| `severity` | ENUM | N | `LOW/MEDIUM/HIGH/CRITICAL` (이유식 자동 경고용 평문 메타) |
| 공통 베이스 | | Y | |

### 4.9 FeedingLog
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `baby_id` | UUID | Y | FK |
| `kind` | ENUM | Y | `BREAST_LEFT/BREAST_RIGHT/BREAST_BOTH/FORMULA/SOLID` |
| `started_at` | TIMESTAMPTZ | Y | 사후 입력 가능 |
| `ended_at` | TIMESTAMPTZ | N | |
| `duration_minutes` | INT | N | |
| `amount_ml` | INT | N | 분유/유축모유 |
| `solid_food_label` | VARCHAR(80) | N | 이유식 메뉴 |
| `notes` | TEXT | N | |
| `merge_candidate_group_id` | UUID | N | 머지 후보 묶음 |
| 공통 베이스 | | Y | (`origin_source`, `voice_*` 포함) |

**제약**
- `CHECK (ended_at IS NULL OR ended_at >= started_at)`
- `CHECK (amount_ml IS NULL OR amount_ml BETWEEN 0 AND 1000)`

**머지 후보 윈도우**: ±2분 + 동일 baby + 동일 kind → `merge_candidate_group_id` 부여 → 사용자 승인 UI

### 4.10 SleepLog
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `baby_id` | UUID | Y | FK |
| `fell_asleep_at` | TIMESTAMPTZ | Y | |
| `woke_up_at` | TIMESTAMPTZ | N | NULL이면 진행 중 |
| `classification` | ENUM | Y | `NAP/NIGHT/UNCLASSIFIED` |
| `auto_classified` | BOOL | Y | |
| `quality` | ENUM | N | `GOOD/FAIR/POOR` |
| `environment_notes` | TEXT | N | |
| `merge_candidate_group_id` | UUID | N | ±20분 윈도우 |
| 공통 베이스 | | Y | |

진행 중 수면(`woke_up_at IS NULL`)은 허용. 같은 `client_event_id`로 마감 PATCH 시 동일 row 업데이트.

### 4.11 DiaperLog
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `baby_id` | UUID | Y | FK |
| `occurred_at` | TIMESTAMPTZ | Y | |
| `kind` | ENUM | Y | `URINE/STOOL/MIXED` |
| `stool_color` | ENUM | N | `YELLOW/GREEN/BROWN/BLACK/WHITE/RED/OTHER` |
| `stool_consistency` | ENUM | N | `WATERY/LOOSE/NORMAL/HARD` |
| `rash_present` | BOOL | N | |
| `anomaly_flag` | ENUM | N | 서버 룰엔진: `none/color_warning/consistency_warning/frequency_warning` |
| `notes` | TEXT | N | |
| `merge_candidate_group_id` | UUID | N | ±3분 윈도우 |
| 공통 베이스 | | Y | |

이상 색상(BLACK/RED/WHITE) 감지 시 → `AITip(severity=EMERGENCY)` 자동 생성.

### 4.12 VoiceAssistantBinding + VoiceInvocation
**VoiceAssistantBinding** (등록)
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `user_id` | UUID | Y | |
| `device_id` | UUID | Y | |
| `platform` | ENUM | Y | `SIRI/GOOGLE/BIXBY` |
| `default_baby_id` | UUID | N | 다중 아기 컨텍스트 |
| `enabled_intents` | TEXT[] | Y | |
| `revoked_at` | TIMESTAMPTZ | N | |

**VoiceInvocation** (호출 이력)
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `binding_id` | UUID | Y | FK |
| `intent` | ENUM | Y | `LOG_FEEDING/LOG_SLEEP_*/LOG_DIAPER/CRY_ANALYZE/QUERY` |
| `raw_utterance_ciphertext` | BYTEA | N | 동의 시 보관 |
| `parsed_slots` | JSONB | Y | |
| `parser_provider` | ENUM | Y | `ON_DEVICE_INTENT/LLM_ASSIST` |
| `llm_invocation_id` | UUID | N | LLM 파싱 시 |
| `resolution_status` | ENUM | Y | `APPLIED/CLARIFICATION_NEEDED/FAILED/OFFLINE_QUEUED` |
| `produced_log_kind` | ENUM | N | `FEEDING/SLEEP/DIAPER/NONE` |
| `produced_log_id` | UUID | N | 폴리모픽 |
| `confidence` | DECIMAL(3,2) | Y | |
| `created_at` | TIMESTAMPTZ | Y | |

토스 채널에서는 VoiceAssistantBinding 생성 자체를 차단(`Device.capabilities.supports_voice_assistant = false`).

### 4.13 CryAnalysisSession ↔ CryAnalysisResult (1:N)
**CryAnalysisSession**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `baby_id` | UUID | Y | |
| `recorded_at` | TIMESTAMPTZ | Y | |
| `duration_seconds` | DECIMAL(4,1) | Y | ≥ 10, ≤ 30 |
| `audio_asset_id` | UUID | N | FK → MediaAsset (즉시 폐기 기본 → NULL) |
| `audio_discard_policy` | ENUM | Y | `DISCARD_IMMEDIATE`(기본) / `RETAIN_FOR_TRAINING_30D` (동의 시) |
| `retention_consent_id` | UUID | N | FK → ConsentRecord |
| `ambient_noise_db` | DECIMAL(4,1) | N | |
| `weather_snapshot` | JSONB | N | |
| `last_feeding_log_id` | UUID | N | 컨텍스트 스냅샷 |
| `last_sleep_log_id` | UUID | N | |
| `last_diaper_log_id` | UUID | N | |
| `triggered_by` | ENUM | Y | `MANUAL/VOICE_ASSISTANT/WIDGET` |
| `app_channel` | ENUM | Y | |
| 공통 베이스 | | Y | |

**CryAnalysisResult** (Session 1:N)
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `session_id` | UUID | Y | FK |
| `llm_invocation_id` | UUID | Y | FK → LLMInvocation |
| `analysis_mode` | ENUM | Y | `ONLINE_PRIMARY/OFFLINE_GEMMA4/ONLINE_REANALYSIS` |
| `reanalysis_of_id` | UUID | N | FK → CryAnalysisResult (재분석 원본) |
| `narrative_summary` | TEXT | Y | |
| `top_cause` | ENUM | Y | `HUNGER/SLEEPY/DISCOMFORT/COLIC/PAIN/OVERSTIMULATION/UNKNOWN/OTHER` |
| `top_confidence` | DECIMAL(3,2) | Y | |
| `confidence_band` | ENUM | Y | `HIGH/MEDIUM/LOW` |
| `ambiguous` | BOOL | Y | |
| `noise_warning` | BOOL | Y | |
| `recommended_action` | TEXT | N | |
| `created_at` | TIMESTAMPTZ | Y | |

오프라인 Gemma 4 결과 → 온라인 복귀 시 새 Result 생성 + `analysis_mode=ONLINE_REANALYSIS` + `reanalysis_of_id` 설정.

### 4.14 Photo + PhotoBabyTag + PhotoKeyWrap
**Photo**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | |
| `media_type` | ENUM | Y | `IMAGE/VIDEO` |
| `mime_type` | VARCHAR(40) | Y | |
| `width_px` | INT | N | |
| `height_px` | INT | N | |
| `duration_ms` | INT | N | 영상 |
| `taken_at` | TIMESTAMPTZ | N | EXIF |
| `calendar_date_local` | DATE | Y | 가족 기본 TZ 비정규화 (달력 키) |
| `calendar_date_source` | ENUM | Y | `EXIF/USER/UPLOAD_TIME` |
| `original_asset_id` | UUID | Y | FK → MediaAsset |
| `thumbnail_asset_id` | UUID | N | FK → MediaAsset |
| `caption_ciphertext` | BYTEA | N | E2E |
| `caption_nonce` | BYTEA | N | |
| `exif_stripped` | BOOL | Y | GPS 자동 제거 |
| `content_hash` | VARCHAR(64) | Y | 중복 감지 (평문 SHA-256) |
| `perceptual_hash` | VARCHAR(32) | N | 유사 사진 묶음 |
| `uploaded_by_user_id` | UUID | Y | VIEWER 포함 가능 |
| `uploaded_via_channel` | ENUM | Y | NATIVE/TOSS_MINIAPP |
| 공통 베이스 | | Y | |

**PhotoBabyTag** (M:N)
| 컬럼 | 타입 | 필수 |
|---|---|---|
| `photo_id` | UUID | Y |
| `baby_id` | UUID | Y |
| `position` | SMALLINT | N |
| `tagged_by_user_id` | UUID | N |
| `tagged_at` | TIMESTAMPTZ | Y |

PK `(photo_id, baby_id)`.

**PhotoKeyWrap** (E2E 핵심)
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | |
| `dek_id` | UUID | Y | DEK 식별자 |
| `dek_version` | INT | Y | 키 회전 세대 |
| `wrapped_for_device_id` | UUID | Y | FK → Device |
| `wrapped_key` | BYTEA | Y | 디바이스 공개키로 래핑된 DEK |
| `algorithm` | ENUM | Y | `X25519_XCHACHA20_POLY1305` |
| `created_at` | TIMESTAMPTZ | Y | |
| `revoked_at` | TIMESTAMPTZ | N | |

UNIQUE `(dek_id, wrapped_for_device_id)`.

**키 회전 워크플로 (새 멤버 추가 / 디바이스 추가·제거 시)**
1. ADMIN 디바이스가 신규 DEK 생성 → `FamilyGroup.active_dek_id` 갱신
2. 활성 디바이스 각각에 대해 새 `PhotoKeyWrap` 발급 (모든 활성 멤버 공개키로 rewrap)
3. 새 멤버/디바이스의 공개키로도 새 `PhotoKeyWrap` 생성
4. 제거된 멤버 디바이스의 모든 `PhotoKeyWrap`은 `revoked_at` 설정
5. 기존 사진은 lazy 재암호화 (혼합 dek_version 허용), 신규 업로드만 신규 DEK 사용
6. `AuditEvent(KEY_ROTATED)` 발행

### 4.15 AIProviderConfig + AIProviderCredential
**AIProviderConfig**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `scope` | ENUM | Y | `FAMILY_GROUP/USER` |
| `family_group_id` | UUID | N | scope=FAMILY_GROUP일 때 |
| `user_id` | UUID | N | scope=USER일 때 (개인 오버라이드) |
| `active_provider` | ENUM | Y | `OPERATOR_GEMINI_FLASH/GEMINI_USER_OAUTH/OPENAI_BYOK/ANTHROPIC_BYOK/ONDEVICE_GEMMA4` |
| `active_model` | VARCHAR(60) | Y | |
| `fallback_chain` | JSONB | Y | 호출 실패 시 시도 순서 |
| `requires_device_keychain` | BOOL | Y | BYOK 시 true → 토스 채널에서 비활성 |
| `requires_on_device_runtime` | BOOL | Y | Gemma 4 → 토스 채널에서 비활성 |
| `allowed_channels` | ENUM[] | Y | `[NATIVE_IOS, NATIVE_ANDROID, TOSS_MINIAPP]` 부분집합 |
| `external_llm_consent_id` | UUID | Y | FK → ConsentRecord |
| `pii_masking_enabled` | BOOL | Y | 기본 true |
| 공통 베이스 | | Y | |

UNIQUE `(family_group_id) WHERE scope=FAMILY_GROUP`, UNIQUE `(user_id) WHERE scope=USER`.

**AIProviderCredential**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `user_id` | UUID | Y | 항상 개인 소유 |
| `provider` | ENUM | Y | `OPENAI/ANTHROPIC/GEMINI_OAUTH` |
| `credential_kind` | ENUM | Y | `API_KEY/OAUTH_TOKEN` |
| `storage_kind` | ENUM | Y | `DEVICE_KEYCHAIN/NOT_ALLOWED` (TOSS 채널은 NOT_ALLOWED) |
| `device_id` | UUID | Y | FK (어느 디바이스 키체인) |
| `keychain_alias` | VARCHAR(120) | Y | 평문 키 미저장 |
| `key_fingerprint` | VARCHAR(64) | Y | 해시 |
| `last_four` | CHAR(4) | Y | UI 표시 |
| `oauth_subscription_tier` | ENUM | N | `NONE/AI_PRO/AI_ULTRA` |
| `verified_at` | TIMESTAMPTZ | N | 연결 테스트 통과 |
| `disabled_at` | TIMESTAMPTZ | N | 무효 감지 시 |

UNIQUE `(user_id, provider, device_id) WHERE disabled_at IS NULL`.

### 4.16 LLMInvocation
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | |
| `requested_by_user_id` | UUID | Y | |
| `device_id` | UUID | Y | |
| `app_channel` | ENUM | Y | NATIVE/TOSS |
| `purpose` | ENUM | Y | `CRY_ANALYSIS/CRY_PATTERN/AI_TIP/VOICE_PARSE/MILESTONE_AUTO_TAG` |
| `subject_kind` | ENUM | N | `CRY_SESSION/BABY/VOICE_INVOCATION/NONE` |
| `subject_id` | UUID | N | 폴리모픽 |
| `provider` | ENUM | Y | |
| `model_id` | VARCHAR(80) | Y | |
| `offline_mode` | BOOL | Y | Gemma 4 |
| `auth_mode` | ENUM | Y | `OPERATOR_KEY/USER_OAUTH/BYOK/ON_DEVICE` |
| `byok_credential_id` | UUID | N | |
| `prompt_template_version` | VARCHAR(20) | Y | |
| `prompt_hash` | VARCHAR(64) | Y | 캐시 키 |
| `cache_hit` | BOOL | Y | |
| `parent_invocation_id` | UUID | N | 폴백/재분석 사슬 |
| `relation_kind` | ENUM | N | `RETRY/FALLBACK/REANALYSIS/CACHE_HIT/NONE` |
| `audio_seconds_input` | DECIMAL(5,2) | N | |
| `tokens_input` | INT | N | |
| `tokens_output` | INT | N | |
| `cost_micro_usd` | BIGINT | N | |
| `billing_party` | ENUM | Y | `OPERATOR/USER_BYOK/USER_OAUTH/NONE` |
| `latency_ms` | INT | N | |
| `status` | ENUM | Y | `STARTED/SUCCESS/FAIL_NETWORK/FAIL_AUTH/FAIL_QUOTA/TIMEOUT/FAIL_MODEL` |
| `consent_snapshot_id` | UUID | N | FK → ConsentRecord |
| `pii_masking_applied` | BOOL | Y | |
| `client_capability_snapshot` | JSONB | N | 호출 시점 채널 기능 |
| `started_at` | TIMESTAMPTZ | Y | |
| `finished_at` | TIMESTAMPTZ | N | |

### 4.17 Subscription + PaymentReceipt (v1 신설)
**Subscription**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `scope` | ENUM | Y | `FAMILY_GROUP/USER` |
| `family_group_id` | UUID | N | |
| `user_id` | UUID | N | |
| `product_code` | VARCHAR(60) | Y | "nyam_pro_monthly" 등 |
| `billing_channel` | ENUM | Y | `APP_STORE/GOOGLE_PLAY/TOSS_IAP/GEMINI_OAUTH_EXTERNAL/BYOK_EXTERNAL` |
| `external_subscription_id` | VARCHAR(255) | Y | Apple original_transaction_id / Toss billing_key 등 |
| `status` | ENUM | Y | `ACTIVE/GRACE/EXPIRED/CANCELED/REFUNDED` |
| `current_period_start` | TIMESTAMPTZ | Y | |
| `current_period_end` | TIMESTAMPTZ | Y | |
| `auto_renew` | BOOL | Y | |
| `cancel_at_period_end` | BOOL | Y | |
| `created_at` | TIMESTAMPTZ | Y | |

UNIQUE `(billing_channel, external_subscription_id)`.

**PaymentReceipt**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `subscription_id` | UUID | Y | FK |
| `billing_channel` | ENUM | Y | |
| `raw_receipt` | TEXT | Y | 영수증 본문 (검증용) |
| `verified_at` | TIMESTAMPTZ | N | |
| `verification_status` | ENUM | Y | `PENDING/VERIFIED/FAILED` |
| `amount_micro` | BIGINT | Y | 마이크로 단위 |
| `currency` | CHAR(3) | Y | |
| `occurred_at` | TIMESTAMPTZ | Y | |

### 4.18 OfflineQueueItem (디바이스 로컬, 서버 미러 X)
**클라이언트 SQLite 테이블**
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `client_event_id` | UUID | Y | 멱등키 |
| `op` | ENUM | Y | `CREATE/UPDATE/DELETE` |
| `entity_kind` | ENUM | Y | |
| `entity_id` | UUID | Y | |
| `payload` | JSONB | Y | 직렬화된 변경 (E2E 컬럼은 이미 ciphertext) |
| `dependency_ids` | UUID[] | N | 선행 큐 아이템 |
| `enqueued_at` | TIMESTAMPTZ | Y | |
| `attempt_count` | INT | Y | 0부터 |
| `last_error` | TEXT | N | |
| `state` | ENUM | Y | `PENDING/IN_FLIGHT/FAILED/CONFLICT_MANUAL_REVIEW/SUCCEEDED` |

**서버 측에는 OfflineQueueItem 테이블 없음.** `SyncConflict` 만 서버에 보관.

### 4.19 SyncConflict / MergeProposal
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | |
| `entity_kind` | ENUM | Y | |
| `entity_id` | UUID | Y | |
| `conflict_kind` | ENUM | Y | `FIELD_LWW_CONFLICT/MERGE_CANDIDATE/DELETE_VS_UPDATE` |
| `server_version` | INT | Y | |
| `client_version` | INT | Y | |
| `server_snapshot` | JSONB | Y | |
| `client_payload` | JSONB | Y | |
| `merge_candidate_group_id` | UUID | N | 같은 윈도우 중복 후보 |
| `resolution` | ENUM | N | `KEEP_SERVER/KEEP_CLIENT/MERGE/SPLIT_AS_SEPARATE/PENDING_USER` |
| `resolved_by_user_id` | UUID | N | |
| `resolved_at` | TIMESTAMPTZ | N | |
| `created_at` | TIMESTAMPTZ | Y | |

머지 후보 윈도우 (도메인별 상수):
- FeedingLog ±2분
- SleepLog ±20분
- DiaperLog ±3분
- Photo ±60초 (연사 묶음)

자동 머지 절대 금지 — `resolution=PENDING_USER`로 두고 클라이언트에서 사용자 승인 UI 표시.

### 4.20 NotificationDispatch
| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | UUIDv7 | Y | PK |
| `family_group_id` | UUID | Y | |
| `recipient_user_id` | UUID | Y | |
| `recipient_device_id` | UUID | N | |
| `kind` | ENUM | Y | `PHOTO_UPLOADED/LOG_CREATED/AI_TIP/VACCINE_DUE/CRY_INSIGHT/INVITATION_ACCEPTED/PROVIDER_FALLBACK/MERGE_PROPOSAL/SUBSCRIPTION_*` |
| `delivery_channel` | ENUM | Y | `APNS/FCM/TOSS_PUSH/IN_APP_ONLY/EMAIL` |
| `payload` | JSONB | Y | |
| `related_entity_kind` | VARCHAR(40) | N | |
| `related_entity_id` | UUID | N | |
| `scheduled_at` | TIMESTAMPTZ | Y | |
| `sent_at` | TIMESTAMPTZ | N | |
| `delivery_status` | ENUM | Y | `QUEUED/SENT/FAILED/SUPPRESSED_QUIET_HOURS/SUPPRESSED_CHANNEL_UNAVAILABLE` |
| `read_at` | TIMESTAMPTZ | N | |

토스 미니앱 사용자에게는 `delivery_channel = TOSS_PUSH` (가용 시) 또는 `IN_APP_ONLY` (보수적 기본).

---

## 5. 채널 매트릭스 (앱인토스 반영)

| UC | NATIVE | TOSS_MINIAPP | 모델 표현 |
|---|---|---|---|
| UC-1.1 울음 분석 (온라인) | ✅ | ✅ (마이크 가능 시) | `LLMInvocation.app_channel`, `Device.capabilities.supports_voice_assistant` |
| UC-1.1 Gemma 4 오프라인 | ✅ | ❌ | `AIProviderConfig.requires_on_device_runtime=true` 시 토스에서 비활성 |
| UC-2.1~2.3 일지 기록 | ✅ | ✅ | 동일 |
| UC-2.5 음성비서 | ✅ | ❌ | `VoiceAssistantBinding` 생성 차단 + `InputSource.TOSS_MINIAPP_MANUAL` |
| UC-3.1 사진 업로드 | ✅ | ✅ | `Photo.uploaded_via_channel` |
| UC-3.2 가족 초대 | ✅ | ✅ | `AuthIdentity.provider=TOSS_OAUTH` 신규 가입 |
| UC-4.4 BYOK | ✅ | ❌ | `AIProviderCredential.storage_kind=NOT_ALLOWED` |
| UC-4.4 Gemini OAuth | ✅ | ✅ | `AIProviderCredential.storage_kind=DEVICE_KEYCHAIN` (토스는 서버 vault 검토 필요) |
| 백그라운드 푸시 | ✅ APNs/FCM | ⚠️ TOSS_PUSH 정책 의존 | `NotificationDispatch.delivery_channel` |
| 인앱 결제 | App Store/Play | Toss IAP | `Subscription.billing_channel` |

---

## 6. v1 / v1.x / v2 스코프

### v1 (출시 범위)
- 36개 핵심 엔티티 (위 §3 표)
- `BabyAccessGrant` (사용자 결정)
- `Subscription/PaymentReceipt/BillingChannel` (사용자 결정)
- `BabyMedicalNote` (민감정보 격리)
- 도메인별 머지 후보 윈도우
- 앱인토스 채널 통합

### v1.x (출시 후 1~2개월 내 추가)
- 영상 처리(`MediaAsset` variant 분리)
- AI Tip 다국어 (i18n_key 마스터 분리)
- Gemma 4 모델 버저닝 (`Device.on_device_models` JSONB)

### v2 (보류)
- `LogEditHistory` (현재는 version + last_edited_by + updated_at으로 충분)
- AlbumItem fractional indexing
- Milestone ↔ Photo M:N
- 음성 화자 인증(VoicePrint)
- 이혼/별거 가족 그룹 split/merge
- 한 아기 → 다중 가족 그룹 공유
- 24개월 초과 자동 아카이브
- `PhotoReaction` (댓글/좋아요)
- 자동 알러지 매칭 (현재는 클라이언트 즉시 경고만)

---

## 7. v1 미해결 (결정 회의 안건)

다음 항목은 v1 출시 전 결정 회의 필요. 위 합의 매트릭스 외 잔여.

1. **LLM quota 한도 단위**: 운영사 키는 가족 단위 + 사용자 단위 이중 한도 (잠정), BYOK은 사용자 단위만
2. **마지막 ADMIN 탈퇴 시 그룹 처리**: 자동 승격 후보(`Membership.joined_at` 최선임 GUARDIAN) + 30일 grace 후 동결
3. **EXIF GPS**: 기본 strip, 가족 단위 ConsentRecord로 opt-in
4. **PDF 외부 공유 시 E2E 우회**: 클라이언트 측 평문 복호화 후 PDF 생성, 서버 미보유
5. **회원 탈퇴 시 데이터**: 본인 PII 삭제, 가족 데이터는 잔류(작성자 anonymized)
6. **CryFeedback 자유 라벨링**: `label_code` 필수 + `label_freeform` 옵셔널 병기
7. **다중 가족 그룹 active context**: `User.active_family_group_id` + Device override 허용
8. **WHO 곡선 마스터 데이터**: `WHOCurveVersion` 마스터 + 서버 계산 + 클라이언트 캐시
9. **앱인토스 미해결 (개발자센터 확인 필요)**:
   - 토스 미니앱 마이크 권한·10초 이상 녹음 가능 여부 (불가 시 UC-1.1 토스 비활성)
   - 토스 푸시 채널 가족 알림 가용성
   - 토스 IAP와 BYOK/Gemini OAuth 결제 충돌 정책
   - 토스 미니앱에서 사진 E2E 키 보관 위치 (브라우저 IndexedDB 보안 한계)
   - 토스 → 네이티브 전환 시 디바이스 키 페어 신규 생성 → 가족 DEK rewrap 트리거

---

## 8. 참조

- 메인 시나리오: [main-scenario.md](../main-scenario.md)
- UC별 상세: [UC-1](../UC-1-cry-analysis/README.md) / [UC-2](../UC-2-parenting-log/README.md) / [UC-3](../UC-3-photo-gallery/README.md) / [UC-4](../UC-4-baby-info-settings/README.md)
- 독립 초안 (Agent A/B/C): [_drafts/](./_drafts/)
- 합의 방식: 3 에이전트 독립 작성 → 3 비판 라운드 상호 검증 → 사용자 결정으로 분열 항목 확정
