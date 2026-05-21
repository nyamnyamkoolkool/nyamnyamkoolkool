# 데이터 모델 (Firestore-native)

> 냠냠쿨쿨 v1 데이터 모델. **Firebase Firestore + Cloud Storage + Authentication + Cloud Functions + FCM** 스택 전제.
> 작성: 2026-05-20.
> 상위: [main-scenario.md](../main-scenario.md). 이전 Postgres 합의안은 [_drafts/data-model-postgres-v1.md](./_drafts/data-model-postgres-v1.md)에 보관(참고용).

---

## 1. 재설계 배경 및 변경 요약

### 변경 사유
- DAU 100 시드 단계에서 **Firebase Spark 무료 한도 활용**으로 첫해 인프라 비용 ~$0 달성
- Firebase Auth (Apple/Google/Kakao + Toss OAuth custom token) + FCM + Realtime listener 기본 제공
- MVP 진입 속도 우선 (사용자 결정)

### Postgres → Firestore 핵심 변환
| 합의 항목 (Postgres) | Firestore 매핑 | 영향 |
|---|---|---|
| RLS | **Security Rules** | 단일 함수로 표현. 단 cross-collection은 비정규화 권장 |
| JOIN | **비정규화 + array 필드 + collection group query** | 사진↔아기는 `baby_ids: string[]` array-contains |
| 폴리모픽 FK | `{linked_kind: enum, linked_id: string}` 쌍 | 클라이언트 사이드 fetch |
| `server_seq` BigInt 단조 | **Firestore `serverTimestamp()` + `updated_at`** | 단조성 약화 — 분 단위 page cursor로 충분 |
| LWW per field | **doc-level `updateMask` + 트랜잭션** | 진정한 per-field LWW는 어렵 → **합의 후퇴: doc-level LWW로 단순화** |
| partial unique, CHECK | **Cloud Functions 검증 + Security Rules `request.resource.data` 체크** | 일부는 클라이언트 + Functions 이중 검증 |
| 도메인 enum | **string + Security Rules `in [...]` 검증** | 런타임 검증, IDE 도움은 TypeScript 타입으로 |
| 트랜잭션 (다중 row) | Firestore `runTransaction` (최대 500 docs / 10MB) | 큰 일괄 작업은 Functions로 |
| `BabyAccessGrant` 별 컬렉션 | **`Membership` doc에 비정규화** (`scopedToBabyIds[]`, `validUntil`) | 매 read마다 권한 조회 1회로 단축 |
| 머지 후보 윈도우 | **Cloud Functions onCreate trigger**가 ±N분 검사 후 `syncConflicts` 생성 | 비동기, 클라이언트는 listener로 수신 |

### 변경된 합의 (사용자 추후 확인 필요 항목)

| 결정 항목 | 이전 합의 | Firestore 후 | 사유 |
|---|---|---|---|
| 충돌 해결 입도 | LWW per field | **doc-level LWW** + `updateMask`로 부분 업데이트 | Firestore는 doc 단위 write가 표준. per-field LWW는 어려움 |
| `server_seq` | BigInt 단조 시퀀스 (가족 단위) | `serverTimestamp()` 기반 정렬 | Cloud Functions로 시퀀스 발급 가능하나 비용·복잡도 대비 가치 낮음 |
| `BabyAccessGrant` 별 컬렉션 | 별도 엔티티 | `Membership` doc 내 nested 필드 | 매 read당 권한 조회 비용 절감 |
| BYOK 키체인 alias | 디바이스 키체인 only | 동일 (Firestore에는 평문 미저장, alias만) | 변경 없음 |
| 머지 후보 자동 생성 | DB 트리거 또는 API 레이어 | **Cloud Functions onCreate trigger** | Firestore-native |
| Soft delete | `deleted_at` 컬럼 | 동일 (`deletedAt` 필드) | 변경 없음 |
| 큐 위치 | 디바이스 SQLite SoT | 동일 | Firestore도 클라이언트 SDK가 오프라인 큐 내장 — 이중 큐 회피 |

---

## 2. 컬렉션 구조 (트리)

> 표기: `/path/{varId}` 는 doc, `[sub]`는 subcollection. `field: type` 은 doc 내 필드.

### 2.1 사용자 레벨 (테넌트 외부)
```
/users/{userId}                                   -- 사용자 정체성
  displayName, locale, timezone, largeTextMode,
  activeFamilyId, status, createdAt, updatedAt, deletedAt
  [authIdentities]/{authId}                       -- TOSS_OAUTH 등 외부 IdP 매핑
  [devices]/{deviceId}                            -- 푸시 토큰, 공개키, capabilities
  [providerCredentials]/{credentialId}            -- BYOK 메타 (keychain alias)
  [consentRecords]/{consentId}                    -- LLM 전송·녹음 보관 등 동의
  [preferences]/main                              -- 알림·접근성 (단일 doc)
```

### 2.2 가족 그룹 (테넌트 루트, 모든 도메인 데이터의 부모)
```
/families/{familyId}
  name, ownerUserId, primaryBabyId, defaultTimezone,
  activeDekId, createdAt, updatedAt, deletedAt

  [memberships]/{userId}                          -- PK = userId (1:1 보장)
    role: 'ADMIN'|'GUARDIAN'|'VIEWER'
    nickname?: string
    wrappedGroupKey: bytes                        -- 그룹 키를 멤버 공개키로 래핑
    scopedToBabyIds?: string[]                    -- BabyAccessGrant 비정규화 (특정 아기 한정)
    validUntil?: Timestamp                        -- 한시적 권한 만료
    joinedAt, leftAt?

  [invitations]/{invitationId}
  [babies]/{babyId}
    legalNameCiphertext?, displayName, pseudonymToken, sex, birthDate, ...
    [medicalNotes]/{noteId}                       -- E2E payload (알러지·기저질환)
    [guardians]/{guardianId}                      -- 엄마/아빠/조부모/시터 관계

  [feedingLogs]/{logId}                           -- baby family-flat (baby_id field)
  [sleepLogs]/{logId}
  [diaperLogs]/{logId}

  [cryAnalysisSessions]/{sessionId}
    [results]/{resultId}                          -- 1 Session : N Result (재분석)
    [feedback]/{feedbackId}
  [cryPatternInsights]/{insightId}

  [photos]/{photoId}
    babyIds: string[]                             -- array-contains 쿼리 (M:N 정규화 대체)
    captionCiphertext?, calendarDateLocal, contentHash, ...
    originalAssetId, thumbnailAssetId             -- mediaAssets 참조
  [photoBabyTags]                                 -- 사용하지 않음, photo doc array로 대체
  [albums]/{albumId}
    [items]/{itemId}                              -- albumId-photoId 매핑
  [milestones]/{milestoneId}                      -- 인스턴스 (마스터는 /milestoneTemplates)
  [memoryCards]/{cardId}                          -- "1년 전 오늘" 캐시
  [mediaAssets]/{assetId}                         -- 객체 스토리지 인덱스
  [photoKeyWraps]/{wrapId}                        -- DEK × 디바이스 공개키 래핑

  [growthMeasurements]/{measurementId}
  [vaccinations]/{vaccinationId}

  [aiTips]/{tipId}
    [feedback]/{feedbackId}
  [aiProviderConfig]/family                       -- 가족 단위 설정 (단일 doc)
  [llmInvocations]/{invocationId}                 -- 모든 LLM 호출 추적
  [llmUsageQuota]/{yearMonth}                     -- 'YYYY-MM' as docId, 누적 카운트

  [subscriptions]/{subscriptionId}
  [paymentReceipts]/{receiptId}

  [voiceAssistantBindings]/{bindingId}            -- Siri/Google/Bixby 등록
  [voiceInvocations]/{invocationId}               -- 음성 호출 이력

  [notifications]/{notificationId}                -- 푸시 발송 이력
  [syncConflicts]/{conflictId}                    -- 충돌·머지 후보
  [auditEvents]/{eventId}                         -- 권한·키·삭제 감사
```

### 2.3 사용자 단위 LLM 설정 (개인 오버라이드)
```
/users/{userId}/aiProviderConfig/user             -- 단일 doc, family 설정을 오버라이드
```

### 2.4 마스터 데이터 (공용)
```
/milestoneTemplates/{code}                        -- 'FIRST_SMILE' 등, locale-aware
/whoCurveVersions/{version}                       -- WHO 성장 곡선
/billingChannels/{code}                           -- 'APP_STORE'/'TOSS_IAP' 등
/featureAvailabilityMatrix/{featureCode}          -- 채널별 가용성 (옵션)
```

---

## 3. 공통 필드 (SyncableEntity 베이스)

모든 도메인 doc는 다음 필드를 갖는다.

```yaml
id: string                          # Firestore docId, UUIDv7 (클라이언트 생성 가능)
familyId: string                    # 비정규화. Security Rules 단순화 용도
babyId?: string                     # 도메인에 따라 선택
createdAt: Timestamp                # serverTimestamp()
updatedAt: Timestamp                # serverTimestamp(), LWW 비교 기준
deletedAt?: Timestamp               # soft delete
version: number                     # optimistic concurrency
lastEditedBy: string                # userId
originDeviceId: string              # deviceId
originSource: enum                  # 'MANUAL_UI' | 'QUICK_REPEAT' | 'VOICE_SIRI' | ...
originInvocationId?: string         # LLM 개입 시 llmInvocations doc id
sourceRawText?: string              # 음성 원문 (저장 동의 시)
sourceConfidence?: number           # 0..1
clientEventId: string               # 멱등키 (UNIQUE 보장은 Cloud Function이 발급/검증)
appChannel: enum                    # 'NATIVE_IOS' | 'NATIVE_ANDROID' | 'TOSS_MINIAPP'
```

**`familyId` 비정규화**: subcollection 구조라 path로 알 수 있지만, **collection group query**(전 가족 collection을 한 번에 쿼리)에서 Security Rules 단순화를 위해 필드로도 보관.

**InputSource enum 값 (변경 없음)**: `MANUAL_UI` / `QUICK_REPEAT` / `VOICE_SIRI` / `VOICE_GOOGLE` / `VOICE_BIXBY` / `TOSS_MINIAPP_MANUAL` / `AI_SUGGESTED` / `AI_INFERRED` / `IMPORTED` / `SYSTEM`

---

## 4. 핵심 컬렉션 상세 (Postgres 합의안과 동일한 의미를 가지는 18개 핵심)

> 필드 일부는 §3 공통 베이스에 포함되어 생략. 도메인 고유 필드만 표시.

### 4.1 `/users/{userId}`
```yaml
displayName: string(60)
email?: string                        # Firebase Auth와 별도 캐시
phoneE164?: string
locale: string(10)                    # 'ko-KR'
timezone: string(40)                  # IANA
largeTextMode: boolean
activeFamilyId?: string               # 다중 가족 가입 시 활성 그룹
voiceSpeakerPrintId?: string          # v2 화자 인증
status: 'ACTIVE'|'SUSPENDED'|'DELETED'
```

### 4.2 `/users/{userId}/authIdentities/{authId}`
```yaml
provider: 'APPLE'|'GOOGLE'|'KAKAO'|'TOSS_OAUTH'|'EMAIL_PASSWORD'|'PASSKEY'
providerSubject: string(255)
linkedAt: Timestamp
lastUsedAt?: Timestamp
lastUsedChannel?: enum
```
- TOSS_OAUTH는 **Firebase Auth Custom Token**으로 통합. Cloud Function이 토스 OAuth 토큰을 검증한 뒤 custom token 발급.

### 4.3 `/users/{userId}/devices/{deviceId}`
```yaml
platform: 'IOS_NATIVE'|'ANDROID_NATIVE'|'TOSS_MINIAPP'|'WEB'
appChannel: enum
osVersion?, appVersion: string
pushToken?: string                    # FCM token (APNs는 FCM이 wrap)
voiceAssistant?: enum
publicKey: bytes                      # X25519
keyFingerprint: string(64)
capabilities:                          # map
  supportsVoiceAssistant: boolean
  supportsOnDeviceLlm: boolean
  supportsBackgroundPush: boolean
  supportsSecureKeystore: boolean
  supportsInAppPurchaseProvider: enum
gemma4ModelVersion?: string
lastSeenAt: Timestamp
revokedAt?: Timestamp                 # 분실 시 DEK rewrap trigger
```

### 4.4 `/families/{familyId}/memberships/{userId}` (PK = userId)
```yaml
role: 'ADMIN'|'GUARDIAN'|'VIEWER'
nickname?: string
wrappedGroupKey: bytes
scopedToBabyIds?: string[]            # BabyAccessGrant 비정규화 — 빈 array이면 가족 전체 권한
validUntil?: Timestamp                # 한시적 권한 (베이비시터)
joinedAt, leftAt?, joinedViaInvitationId?
```

**권한 확인 패턴 (단일 get)**:
```javascript
function canAccessBaby(membership, babyId) {
  if (!membership.scopedToBabyIds || membership.scopedToBabyIds.length === 0) return true;
  return membership.scopedToBabyIds.includes(babyId);
}
function isWithinValidity(membership) {
  return !membership.validUntil || membership.validUntil > Timestamp.now();
}
```

### 4.5 `/families/{familyId}/babies/{babyId}`
```yaml
legalNameCiphertext?: bytes           # E2E 가족 DEK
legalNameNonce?: bytes
displayName: string(40)
pseudonymToken: string(40)            # LLM 프롬프트용 가명
sex: 'FEMALE'|'MALE'|'UNSPECIFIED'
birthDate: string                     # 'YYYY-MM-DD'
birthTime?: string                    # 'HH:MM'
gestationalWeeks?: number
preterm: boolean                       # derived
birthWeightG?, birthHeightMm?
profilePhotoId?: string
archivedAt?: Timestamp
```

### 4.6 `/families/{familyId}/babies/{babyId}/medicalNotes/{noteId}`
```yaml
category: 'ALLERGY'|'CHRONIC'|'MEDICATION'|'NOTE'
payloadCiphertext: bytes              # E2E (라벨 + 자유텍스트)
payloadNonce: bytes
severity?: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'   # 평문 메타 (이유식 자동 경고용)
```

### 4.7 `/families/{familyId}/feedingLogs/{logId}`
```yaml
babyId: string
kind: 'BREAST_LEFT'|'BREAST_RIGHT'|'BREAST_BOTH'|'FORMULA'|'SOLID'
startedAt: Timestamp
endedAt?: Timestamp
durationMinutes?: number
amountMl?: number                     # 0..1000
solidFoodLabel?: string(80)
notes?: string
mergeCandidateGroupId?: string        # Cloud Function이 ±2분 윈도우 발견 시 부여
```

**클라이언트 검증 + Security Rules + Cloud Function 삼중 검증**:
- 클라이언트: TypeScript 타입 / Zod 스키마
- Security Rules: `request.resource.data.amountMl >= 0 && request.resource.data.amountMl <= 1000`
- Cloud Function (onCreate trigger): 머지 후보 검색, mergeCandidateGroupId 부여

### 4.8 `/families/{familyId}/sleepLogs/{logId}`
```yaml
babyId: string
fellAsleepAt: Timestamp
wokeUpAt?: Timestamp                  # NULL = 진행 중
classification: 'NAP'|'NIGHT'|'UNCLASSIFIED'
autoClassified: boolean
quality?: 'GOOD'|'FAIR'|'POOR'
environmentNotes?: string
mergeCandidateGroupId?: string        # ±20분 윈도우
```

### 4.9 `/families/{familyId}/diaperLogs/{logId}`
```yaml
babyId: string
occurredAt: Timestamp
kind: 'URINE'|'STOOL'|'MIXED'
stoolColor?: 'YELLOW'|'GREEN'|'BROWN'|'BLACK'|'WHITE'|'RED'|'OTHER'
stoolConsistency?: 'WATERY'|'LOOSE'|'NORMAL'|'HARD'
rashPresent?: boolean
anomalyFlag?: 'none'|'color_warning'|'consistency_warning'|'frequency_warning'
notes?: string
mergeCandidateGroupId?: string        # ±3분 윈도우
```

이상 색상(BLACK/RED/WHITE) 감지 시 → Cloud Function이 `aiTips` 컬렉션에 `severity=EMERGENCY` 팁 자동 생성.

### 4.10 `/families/{familyId}/cryAnalysisSessions/{sessionId}`
```yaml
babyId: string
recordedAt: Timestamp
durationSeconds: number               # ≥10, ≤30
audioAssetId?: string                 # mediaAssets 참조, 즉시 폐기 기본 → null
audioDiscardPolicy: 'DISCARD_IMMEDIATE'|'RETAIN_FOR_TRAINING_30D'
retentionConsentId?: string
ambientNoiseDb?: number
weatherSnapshot?: map
lastFeedingLogId?, lastSleepLogId?, lastDiaperLogId?
triggeredBy: 'MANUAL'|'VOICE_ASSISTANT'|'WIDGET'
```

### 4.11 `/families/{familyId}/cryAnalysisSessions/{sessionId}/results/{resultId}`
```yaml
llmInvocationId: string               # llmInvocations 참조
analysisMode: 'ONLINE_PRIMARY'|'OFFLINE_GEMMA4'|'ONLINE_REANALYSIS'
reanalysisOfId?: string               # 재분석 원본 result
narrativeSummary: string
topCause: 'HUNGER'|'SLEEPY'|'DISCOMFORT'|'COLIC'|'PAIN'|'OVERSTIMULATION'|'UNKNOWN'|'OTHER'
topConfidence: number                 # 0..1
confidenceBand: 'HIGH'|'MEDIUM'|'LOW'
ambiguous: boolean
noiseWarning: boolean
recommendedAction?: string
candidates: array<map>                # [{rank, cause, confidence, rationale, recommendedAction}]
```

**Postgres `CryCandidate` 별 row → Firestore array 필드**로 비정규화 (Result 1건 = 후보 1~3개).

### 4.12 `/families/{familyId}/photos/{photoId}`
```yaml
babyIds: string[]                     # M:N 정규화 대체. array-contains 쿼리
mediaType: 'IMAGE'|'VIDEO'
mimeType: string
widthPx?, heightPx?, durationMs?
takenAt?: Timestamp
calendarDateLocal: string             # 'YYYY-MM-DD' (가족 기본 TZ)
calendarDateSource: 'EXIF'|'USER'|'UPLOAD_TIME'
originalAssetId: string               # mediaAssets 참조
thumbnailAssetId?: string
captionCiphertext?, captionNonce?     # E2E
exifStripped: boolean
contentHash: string(64)               # SHA-256 평문 (중복 감지)
perceptualHash?: string(32)
uploadedByUserId: string
uploadedViaChannel: 'NATIVE_*'|'TOSS_MINIAPP'
```

### 4.13 `/families/{familyId}/mediaAssets/{assetId}`
**Firestore와 객체 스토리지 분리**: 메타만 Firestore. **본체는 컬렉션별로 다른 클라우드** (2026-05-21 결정).

| 미디어 종류 | 저장소 | 사유 |
|---|---|---|
| **사진·영상 본체 (PHOTO_*, VIDEO_*)** | **Kakao Cloud Object Storage** | 한국 데이터 거주성, 세금계산서, Kakao OAuth·알림톡 시너지, NCP 대비 ~15% 저렴 |
| 울음 오디오 (CRY_AUDIO) | Firebase Cloud Storage (기본 즉시 폐기) | 단기 보관, Cloud Functions 트리거 통합 |
| 프로필 아바타 (PROFILE_AVATAR) | Firebase Cloud Storage | 작은 파일, 권한 통합 |
| PDF export (PDF_EXPORT) | Firebase Cloud Storage (24h 임시) | 짧은 TTL |

```yaml
kind: 'PHOTO_ORIGINAL'|'PHOTO_THUMBNAIL'|'VIDEO_ORIGINAL'|'VIDEO_PREVIEW'|'CRY_AUDIO'|'PROFILE_AVATAR'|'PDF_EXPORT'
storageProvider: 'FIREBASE_GCS'|'KAKAO_OBJECT_STORAGE'   # 신규
storageBucket: string                                   # 예: 'nyamnyam-photos-kr' 또는 'gs://nyamnyam-prod.appspot.com'
storageObjectPath: string                               # 예: 'families/{fid}/photos/{aid}.enc'
storageRegion: string?                                  # 'kr-central-1' (Kakao Cloud) / 'asia-northeast3' (Firebase)
byteSize: number
contentType: string
contentHash: string(64)
encryptionScheme: 'NONE'|'AES_GCM_FAMILY_DEK'|'SERVER_SIDE_KMS'
dekId?: string                                          # photoKeyWraps 참조
nonce?: bytes
retentionPolicy: 'PERMANENT'|'EPHEMERAL_24H'|'USER_OPT_IN_30D'
expiresAt?: Timestamp
```

**Pre-Signed URL 흐름 (사진 업로드, NCP)**:
1. 클라이언트 → Cloud Function `issueKakaoUploadUrl(familyId, photoId, byteSize)`
2. Cloud Function이 권한 검증 → Kakao Cloud S3 호환 API로 Pre-Signed PUT URL 생성 (TTL 15분)
3. 클라이언트가 가족 DEK로 본체 암호화 → Kakao Cloud에 직접 PUT
4. 클라이언트 → Cloud Function `confirmPhotoUpload(familyId, photoId, contentHash, byteSize)`
5. Cloud Function이 `mediaAssets` doc 생성 (`storageProvider='KAKAO_OBJECT_STORAGE'`) + `photos` doc 생성 + 가족에게 푸시

**Pre-Signed URL 흐름 (다운로드)**:
1. 클라이언트가 `photos`·`mediaAssets` 메타 조회 (Firestore listener)
2. `storageProvider`가 `KAKAO_OBJECT_STORAGE`이면 Cloud Function `issueKakaoDownloadUrl(assetId)` 호출
3. Cloud Function 권한 검증 후 Pre-Signed GET URL 발급 (TTL 1시간)
4. 클라이언트가 Kakao Cloud에서 직접 GET → DEK로 복호화 → 표시

### 4.14 `/families/{familyId}/photoKeyWraps/{wrapId}`
```yaml
dekId: string                         # 같은 DEK 세대를 가리키는 group key
dekVersion: number                    # 키 회전 세대
wrappedForDeviceId: string
wrappedKey: bytes
algorithm: 'X25519_XCHACHA20_POLY1305'
revokedAt?: Timestamp
```

**복합 인덱스 필요**: `(dekId, wrappedForDeviceId)` unique 검증은 Cloud Function이 수행.

### 4.15 `/families/{familyId}/aiProviderConfig/family` (단일 doc, docId = 'family')
```yaml
activeProvider: 'OPERATOR_GEMINI_FLASH'|'GEMINI_USER_OAUTH'|'OPENAI_BYOK'|'ANTHROPIC_BYOK'|'ONDEVICE_GEMMA4'
activeModel: string(60)
fallbackChain: array<string>
requiresDeviceKeychain: boolean
requiresOnDeviceRuntime: boolean
allowedChannels: array<enum>          # 'NATIVE_*'|'TOSS_MINIAPP' 부분집합
externalLlmConsentId: string
piiMaskingEnabled: boolean            # 기본 true
```

`/users/{userId}/aiProviderConfig/user`는 개인 오버라이드. 가족 doc과 동일 스키마.

### 4.16 `/users/{userId}/providerCredentials/{credentialId}` (개인 소유)
```yaml
provider: 'OPENAI'|'ANTHROPIC'|'GEMINI_OAUTH'
credentialKind: 'API_KEY'|'OAUTH_TOKEN'
storageKind: 'DEVICE_KEYCHAIN'|'NOT_ALLOWED'   # TOSS_MINIAPP은 NOT_ALLOWED
deviceId: string                      # 어느 디바이스 키체인
keychainAlias: string(120)            # 평문 키 미저장
keyFingerprint: string(64)
lastFour: string(4)
oauthSubscriptionTier?: 'NONE'|'AI_PRO'|'AI_ULTRA'
verifiedAt?, disabledAt?
```

### 4.17 `/families/{familyId}/llmInvocations/{invocationId}`
```yaml
requestedByUserId, deviceId, appChannel
purpose: 'CRY_ANALYSIS'|'CRY_PATTERN'|'AI_TIP'|'VOICE_PARSE'|'MILESTONE_AUTO_TAG'
subjectKind?: 'CRY_SESSION'|'BABY'|'VOICE_INVOCATION'|'NONE'
subjectId?: string                    # 폴리모픽 — 클라이언트 사이드 fetch
provider: enum
modelId: string(80)
offlineMode: boolean                  # Gemma 4
authMode: 'OPERATOR_KEY'|'USER_OAUTH'|'BYOK'|'ON_DEVICE'
byokCredentialId?: string
promptTemplateVersion: string
promptHash: string(64)                # 캐시 키
cacheHit: boolean
parentInvocationId?: string           # 폴백/재분석 사슬
relationKind?: 'RETRY'|'FALLBACK'|'REANALYSIS'|'CACHE_HIT'|'NONE'
audioSecondsInput?, tokensInput?, tokensOutput?
costMicroUsd?: number
billingParty: 'OPERATOR'|'USER_BYOK'|'USER_OAUTH'|'NONE'
latencyMs?: number
status: 'STARTED'|'SUCCESS'|'FAIL_NETWORK'|'FAIL_AUTH'|'FAIL_QUOTA'|'TIMEOUT'|'FAIL_MODEL'
consentSnapshotId?, piiMaskingApplied
clientCapabilitySnapshot?: map
startedAt, finishedAt?
```

### 4.18 `/families/{familyId}/llmUsageQuota/{yearMonth}` (docId = 'YYYY-MM')
```yaml
yearMonth: '2026-05'
provider: enum                        # 운영사 키 한정
requestCount: number
audioSecondsSum: number
tokensInputSum, tokensOutputSum: number
costMicroUsdSum: number
quotaLimit?: number
exceededAt?: Timestamp
```

**Cloud Function increment** (`FieldValue.increment(1)`)로 LLMInvocation 생성 시 자동 누적.

### 4.19 `/families/{familyId}/subscriptions/{subscriptionId}` + `/paymentReceipts/{receiptId}` (v1 신설)
```yaml
# subscriptions
scope: 'FAMILY_GROUP'|'USER'
userId?: string                       # scope=USER일 때
productCode: string(60)
billingChannel: 'APP_STORE'|'GOOGLE_PLAY'|'TOSS_IAP'|'GEMINI_OAUTH_EXTERNAL'|'BYOK_EXTERNAL'
externalSubscriptionId: string        # Apple/Google/Toss billing key
status: 'ACTIVE'|'GRACE'|'EXPIRED'|'CANCELED'|'REFUNDED'
currentPeriodStart, currentPeriodEnd: Timestamp
autoRenew, cancelAtPeriodEnd: boolean
```
- Cloud Function이 Toss/Apple/Google webhook 수신 → 상태 갱신.

### 4.20 `/families/{familyId}/syncConflicts/{conflictId}`
```yaml
entityKind: enum                      # 'feedingLog'|'sleepLog'|...
entityId: string
conflictKind: 'FIELD_LWW_CONFLICT'|'MERGE_CANDIDATE'|'DELETE_VS_UPDATE'
serverVersion, clientVersion: number
serverSnapshot, clientPayload: map
mergeCandidateGroupId?: string
resolution?: 'KEEP_SERVER'|'KEEP_CLIENT'|'MERGE'|'SPLIT_AS_SEPARATE'|'PENDING_USER'
resolvedByUserId?, resolvedAt?
```

**머지 후보 발견 흐름** (Cloud Function):
```
1. /families/{fid}/feedingLogs/{logId} onCreate trigger
2. 동일 babyId, kind, ±2분 윈도우 검색
3. 후보 발견 시:
   - 신규 doc의 mergeCandidateGroupId = uuid()
   - 기존 후보 doc의 mergeCandidateGroupId 동일 값으로 업데이트
   - /families/{fid}/syncConflicts/{conflictId} 생성 (resolution='PENDING_USER')
4. 클라이언트 리스너가 syncConflicts 컬렉션 구독 → 사용자 승인 UI 표시
```

---

## 5. Security Rules (핵심 패턴)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    // === 사용자 본인 ===
    match /users/{userId} {
      allow read, update: if request.auth.uid == userId;
      allow create: if request.auth.uid == userId;
      allow delete: if false;       // 회원 탈퇴는 Cloud Function 경유

      match /{collection}/{docId=**} {
        allow read, write: if request.auth.uid == userId;
      }
    }

    // === 가족 그룹 ===
    match /families/{fid} {

      function membership() {
        return get(/databases/$(db)/documents/families/$(fid)/memberships/$(request.auth.uid));
      }

      function isMember() {
        return exists(/databases/$(db)/documents/families/$(fid)/memberships/$(request.auth.uid))
            && membership().data.leftAt == null
            && (membership().data.validUntil == null || membership().data.validUntil > request.time);
      }

      function hasRole(roles) {
        return isMember() && membership().data.role in roles;
      }

      function isAdmin()    { return hasRole(['ADMIN']); }
      function isGuardian() { return hasRole(['ADMIN', 'GUARDIAN']); }

      function canAccessBaby(babyId) {
        let m = membership().data;
        return m.scopedToBabyIds == null || m.scopedToBabyIds.size() == 0 || babyId in m.scopedToBabyIds;
      }

      // 가족 doc 자체
      allow read: if isMember();
      allow update: if isAdmin();
      allow create, delete: if false;        // Cloud Function 경유

      // 멤버십
      match /memberships/{userId} {
        allow read: if isMember();
        allow write: if isAdmin();
      }

      // 초대
      match /invitations/{invitationId} {
        allow read: if isMember();
        allow create: if isAdmin();
        allow update: if isAdmin();
      }

      // 아기 프로필
      match /babies/{babyId} {
        allow read: if isMember() && canAccessBaby(babyId);
        allow create, update: if isGuardian() && canAccessBaby(babyId);
        allow delete: if isAdmin();

        match /medicalNotes/{noteId} {
          allow read, write: if isGuardian() && canAccessBaby(babyId);
        }
        match /guardians/{guardianId} {
          allow read: if isMember() && canAccessBaby(babyId);
          allow write: if isAdmin();
        }
      }

      // 일지류 (수유/수면/배변)
      match /{logKind}/{logId}
            where logKind in ['feedingLogs', 'sleepLogs', 'diaperLogs'] {
        allow read: if isMember() && canAccessBaby(resource.data.babyId);
        allow create: if isGuardian()
                      && canAccessBaby(request.resource.data.babyId)
                      && request.resource.data.familyId == fid;
        allow update: if isGuardian()
                      && (isAdmin() || resource.data.lastEditedBy == request.auth.uid);
        allow delete: if isAdmin()
                      || (isGuardian() && resource.data.lastEditedBy == request.auth.uid);
      }

      // 사진
      match /photos/{photoId} {
        // VIEWER도 업로드 허용 (UC-3.2 + 사용자 합의)
        allow read: if isMember();
        allow create: if isMember()
                      && request.resource.data.uploadedByUserId == request.auth.uid;
        allow update: if isGuardian() || resource.data.uploadedByUserId == request.auth.uid;
        allow delete: if isAdmin() || resource.data.uploadedByUserId == request.auth.uid;
      }

      // 울음 분석
      match /cryAnalysisSessions/{sessionId} {
        allow read: if isMember() && canAccessBaby(resource.data.babyId);
        allow create: if isMember();         // 모든 멤버가 분석 실행 가능
        allow update: if false;              // Cloud Function 경유
        allow delete: if isAdmin();

        match /results/{resultId} {
          allow read: if isMember();
          allow write: if false;             // Cloud Function 경유 (LLM 호출 결과)
        }
        match /feedback/{feedbackId} {
          allow read, create: if isMember();
        }
      }

      // AI Provider Config (가족 단위)
      match /aiProviderConfig/family {
        allow read: if isMember();
        allow write: if isAdmin();
      }

      // LLM Invocations / Quota (운영성, 클라이언트 직접 작성 금지)
      match /llmInvocations/{invocationId} {
        allow read: if isMember();
        allow write: if false;               // Cloud Function 경유
      }
      match /llmUsageQuota/{yearMonth} {
        allow read: if isMember();
        allow write: if false;
      }

      // 구독·결제
      match /subscriptions/{subId} {
        allow read: if isMember();
        allow write: if false;               // Cloud Function (webhook 경유)
      }
      match /paymentReceipts/{rid} {
        allow read: if isAdmin();
        allow write: if false;
      }

      // 감사 이벤트 (append-only)
      match /auditEvents/{eventId} {
        allow read: if isAdmin();
        allow create: if false;              // Cloud Function 경유
        allow update, delete: if false;
      }

      // 동기화 충돌
      match /syncConflicts/{conflictId} {
        allow read: if isMember();
        allow update: if isMember();         // 사용자 승인 가능
        allow create: if false;
        allow delete: if false;
      }
    }
  }
}
```

**Security Rules 비용 주의사항**:
- `get()`·`exists()` 호출은 Firestore read 1건으로 과금
- `membership()` 함수가 한 요청 내 1회만 평가되도록 rules 컴파일러가 캐시
- 권한 검증을 위한 read가 도메인 read보다 더 비싸지 않도록 비정규화 권장

---

## 6. Cloud Functions (Cloud Functions for Firebase v2 / Cloud Run)

### 6.1 트리거 함수 (필수)

| 함수 | 트리거 | 책임 |
|---|---|---|
| `onMembershipChange` | `/families/{fid}/memberships/{uid}` write | DEK rewrap (새 멤버/제거/디바이스 변경 시 일괄 `photoKeyWraps` 갱신) + AuditEvent |
| `onLogCreate` | `/families/{fid}/feedingLogs/{id}` 등 onCreate | ±N분 윈도우 검색 → `syncConflicts` 생성 (mergeCandidate) |
| `onDiaperLogCreate` | DiaperLog onCreate | 이상 색상(BLACK/RED/WHITE) 감지 → `aiTips` EMERGENCY 생성 |
| `onLlmInvocationCreate` | `/families/{fid}/llmInvocations/{id}` onCreate | `llmUsageQuota/{yearMonth}` increment |
| `onSubscriptionWebhook` | HTTPS callable (Toss/Apple/Google webhook) | `subscriptions` 상태 갱신 + `paymentReceipts` 생성 |
| `issueKakaoUploadUrl` | HTTPS callable | Kakao Cloud Pre-Signed PUT URL 발급 (TTL 15분), 권한 검증 |
| `confirmPhotoUpload` | HTTPS callable | NCP 업로드 완료 후 `mediaAssets`·`photos` doc 생성, 가족 푸시 |
| `issueKakaoDownloadUrl` | HTTPS callable | Kakao Cloud Pre-Signed GET URL 발급 (TTL 1시간) |
| `onCryAudioUpload` (Firebase Storage) | Cloud Storage onFinalize | 울음 오디오 메타 등록, 분석 큐잉 |
| `onCryAnalysisRequest` | HTTPS callable | LLM 호출 → `cryAnalysisSessions/{sid}/results/{rid}` 생성 + `llmInvocations` 생성 |
| `onTossOAuthCallback` | HTTPS callable | 토스 OAuth 토큰 검증 → Firebase Auth custom token 발급 |
| `dailyAggregations` | Pub/Sub scheduled | 운영 메트릭 집계, `llmUsageQuota` 검증, 만료 미디어 폐기 |
| `cryAudioPurge` | Pub/Sub scheduled hourly | `audioDiscardPolicy=DISCARD_IMMEDIATE`인 오디오 즉시 폐기 |

### 6.2 검증 함수 (callable, 클라이언트가 호출)
| 함수 | 책임 |
|---|---|
| `createInvitation` | 초대 토큰 발급 (해시 검증·만료 설정) |
| `acceptInvitation` | 토큰 검증·`memberships` 생성·DEK rewrap 큐잉 |
| `removeMembership` | 멤버 제거·DEK rewrap 큐잉·AuditEvent |
| `requestReanalysis` | 오프라인 결과를 본 모델로 재분석 요청 |
| `linkAuthProvider` | TOSS_OAUTH 추가 연결 |

---

## 7. 클라이언트 SDK 가이드

### 7.1 오프라인 큐 = Firestore SDK 내장 큐 활용
**핵심**: Firestore Mobile SDK는 기본적으로 오프라인 캐시 + 큐를 제공한다. 별도 SQLite 큐 불요(이전 합의 `OfflineQueueItem` 디바이스 테이블은 **불필요**).

```swift
// Swift 예시
let db = Firestore.firestore()
db.settings.isPersistenceEnabled = true        // 기본 true
db.settings.cacheSizeBytes = 100 * 1024 * 1024 // 100MB

try await db.collection("families/\(fid)/feedingLogs")
  .document(logId)
  .setData(feedingLog)                         // 오프라인이면 자동 큐
```

**합의 변경**: 디바이스 큐는 Firestore SDK에 위임. 단 **상태 가시화**(사용자에게 "동기화 대기 N건" 표시)는 `db.disableNetwork()` 상태 체크 + `pendingWrites` 카운트로 구현.

### 7.2 실시간 동기화
가족 그룹 단위 listener 1~3개로 거의 모든 UI 갱신:
```typescript
onSnapshot(
  query(collection(db, `families/${fid}/feedingLogs`),
        where('babyId', '==', babyId),
        orderBy('startedAt', 'desc'),
        limit(50)),
  (snap) => updateUI(snap.docs)
);
```
**비용 주의**: listener는 활성 동안 read당 과금. 가족당 평균 3 listener × 활성 시간 × 변경 빈도 = 월 read 예측.

### 7.3 E2E 암호화 처리
1. 가족 가입 시 클라이언트가 X25519 키페어 생성 → 비밀키 디바이스 키체인, 공개키 `devices` doc에 등록
2. ADMIN 디바이스가 가족 DEK 생성 → 멤버 공개키로 래핑 → `photoKeyWraps` 컬렉션에 멤버×디바이스만큼 doc 생성
3. 사진 업로드 시: 클라이언트가 DEK로 AES-GCM 암호화 → ciphertext만 Cloud Storage 업로드, `photos` doc은 메타만
4. 멤버 추가/제거 시: `onMembershipChange` Cloud Function이 새 DEK 발급 + 활성 디바이스에 rewrap 요청 푸시

---

## 8. 인덱스 (Firestore composite index)

다음 복합 인덱스가 필요. Firebase Console 또는 `firestore.indexes.json`으로 선언.

```yaml
- collectionGroup: feedingLogs
  fields: [babyId ASC, startedAt DESC]
- collectionGroup: sleepLogs
  fields: [babyId ASC, fellAsleepAt DESC]
- collectionGroup: diaperLogs
  fields: [babyId ASC, occurredAt DESC]
- collectionGroup: photos
  fields: [familyId ASC, calendarDateLocal DESC]
- collectionGroup: photos
  fields: [familyId ASC, contentHash ASC]      # 중복 감지
- collectionGroup: photos
  fields: [babyIds array-contains, calendarDateLocal DESC]
- collectionGroup: cryAnalysisSessions
  fields: [babyId ASC, recordedAt DESC]
- collectionGroup: llmInvocations
  fields: [provider ASC, status ASC, startedAt DESC]
- collectionGroup: llmInvocations
  fields: [offlineMode ASC, status ASC, startedAt DESC]  # 재분석 후보
- collectionGroup: syncConflicts
  fields: [resolution ASC, createdAt DESC]
- collectionGroup: notifications
  fields: [recipientUserId ASC, scheduledAt DESC]
```

---

## 9. 채널 매트릭스 (앱인토스 반영, 변경 없음)

| UC | NATIVE | TOSS_MINIAPP | 모델 표현 |
|---|---|---|---|
| UC-1.1 울음 분석 (온라인) | ✅ | ✅ (마이크 가능 시) | `llmInvocations.appChannel`, `devices.capabilities` |
| UC-1.1 Gemma 4 오프라인 | ✅ | ❌ | `aiProviderConfig.requiresOnDeviceRuntime=true` 시 비활성 |
| UC-2.1~2.3 일지 기록 | ✅ | ✅ | 동일 |
| UC-2.5 음성비서 | ✅ | ❌ | `voiceAssistantBindings` 생성 차단 |
| UC-3.1 사진 업로드 | ✅ | ✅ | `photos.uploadedViaChannel` |
| UC-3.2 가족 초대 | ✅ | ✅ | `authIdentities.provider=TOSS_OAUTH` |
| UC-4.4 BYOK | ✅ | ❌ | `providerCredentials.storageKind=NOT_ALLOWED` |
| 인앱 결제 | App Store/Play | Toss IAP | `subscriptions.billingChannel` |

---

## 10. v1 / v1.x / v2 스코프

### v1 (출시 범위)
- 위 §2~§4의 모든 컬렉션
- BabyAccessGrant는 **Membership doc 내 nested로 비정규화**
- Subscription/PaymentReceipt/BillingChannel
- BabyMedicalNote (E2E)
- 도메인별 머지 후보 윈도우 (Cloud Functions)
- 앱인토스 채널 통합

### v1.x (출시 후 1~2개월 내)
- 영상 처리 variant
- AI Tip 다국어 (i18n_key 마스터)
- Gemma 4 모델 버저닝 (Device 필드)
- 결제 webhook 견고화

### v2 (보류, 변경 없음)
- LogEditHistory 분리
- AlbumItem fractional indexing
- Milestone ↔ Photo M:N
- 음성 화자 인증
- 이혼/별거 그룹 split/merge
- 한 아기 → 다중 가족 그룹 공유
- 24개월 초과 자동 아카이브
- PhotoReaction (댓글/좋아요)
- 자동 알러지 매칭

---

## 11. v1 미해결 (결정 회의 안건)

기존 합의안에서 이월 + Firestore 특화 신규:

**이월**
1. LLM quota 한도 단위 (가족 + 사용자 이중)
2. 마지막 ADMIN 탈퇴 시 그룹 처리
3. EXIF GPS 처리
4. PDF 외부 공유 시 E2E 우회
5. 회원 탈퇴 시 데이터 처리
6. CryFeedback 자유 라벨링 (label_code + label_freeform 병기)
7. 다중 가족 그룹 active context
8. WHO 곡선 마스터 데이터

**Firestore 특화 신규**
9. **Cloud Functions 트리거 결합도 한계**: 머지 후보 검색이 onCreate 단일 트리거로 충분한가, 배치 보강 필요한가
10. **읽기 비용 폭증 위험 모니터링**: 가족 그룹 listener 수·active duration 추적 (월 read 예산 설정)
11. **Custom Token 발급 (TOSS_OAUTH)**: Firebase Auth와 토스 OAuth refresh 토큰 동기화 정책
12. **앱인토스 + Firebase Web SDK**: 토스 미니앱(WebView) 환경에서 Firebase Web SDK 동작·persistence 확인 필요
13. **Per-field LWW 포기의 영향**: 두 사용자가 같은 doc의 다른 필드를 동시 수정 시 마지막 write가 전체 doc 덮어쓰기 → `updateMask` 패턴 + 트랜잭션 가이드 명시
14. **collection group query 인덱스 비용**: 가족 수가 늘면 collection group query는 모든 가족 가로지름 → 인덱스 비용 모니터링

---

## 12. 참조

- 메인 시나리오: [main-scenario.md](../main-scenario.md)
- UC별 상세: [UC-1](../UC-1-cry-analysis/README.md) / [UC-2](../UC-2-parenting-log/README.md) / [UC-3](../UC-3-photo-gallery/README.md) / [UC-4](../UC-4-baby-info-settings/README.md)
- 클라우드 비교: [cloud-cost-comparison.md](./cloud-cost-comparison.md)
- 이전 Postgres 합의안 (참고): [_drafts/data-model-postgres-v1.md](./_drafts/data-model-postgres-v1.md)
- 독립 초안 (Agent A/B/C): [_drafts/](./_drafts/)
