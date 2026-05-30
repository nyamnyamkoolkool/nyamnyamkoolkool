# UC-2 dev-plan 비판 노트

> [dev-plan-android.md](./dev-plan-android.md), [dev-plan-ios.md](./dev-plan-ios.md)에 대해 5개 서브에이전트(시니어 모바일 아키텍트 / UX·PM / Firestore 데이터 엔지니어 / 보안·프라이버시 / 데블스 어드보킷)로 병렬 적대적 리뷰를 수행한 결과 기록.
> 검토일: 2026-05-23. **결정·반영 여부는 미정**.

---

## 검토 방법

| 관점 | 주요 시야 |
|---|---|
| 시니어 모바일 아키텍트 | DI 일관성, Repository 추상화, 두 플랫폼 표류, 테스트 가능성, OS 정책, Strict Concurrency |
| UX / 제품 PM | KPI 달성 가능성, Smart Default 신뢰성, 발견성, 제스처 충돌, 음성 미포함의 영향 |
| Firestore / 데이터 엔지니어 | SDK 캐시·큐·인덱스·listener 비용, 직렬화 함정, 멱등성, 익명→실제 마이그레이션 |
| 보안 / 프라이버시 | 익명 Auth 데이터 손실, 로컬 캐시 평문, KPI에 PII 누출, Privacy Manifest, KeyStore/Keychain 정책 |
| 데블스 어드보킷 | 슬라이스 범위·플랫폼 병렬·문서 작성 자체에 대한 메타 도전 |

각 에이전트에게 "동의·중립 멘트 금지, 합의 완료 항목(데이터 모델·UX 4원칙·슬라이스 범위)은 비판 대상 외, 구현 계획만 비판" 지시.

---

## 1. 합의도 높은 비판 (2명 이상 지목)

| # | 약점 | 강도 | 지목 에이전트 | 검토 상태 |
|---|---|---|---|---|
| C1 | 익명 Auth UID는 앱 삭제·Keychain 클리어·OS 권한 회수 시 영구 소멸 → 일지 전부 고아화. v1.1 Cloud Function 마이그레이션으로 미룬 결정이 v1 베타 기간 동안 데이터 손실 누적을 방치 | **blocker** | 보안 · Firestore · 데블스 | 미결정 |
| C2 | "Firestore 미연결 슬라이스에서 write 무한 큐잉은 무해"는 거짓. `cacheSizeBytes` 100MB에 mutation queue가 포함되고 LRU GC는 pending mutation을 못 깎음. v1.1 Security Rules ON 순간 큐 write가 PERMISSION_DENIED로 전부 손실 | **blocker** | Firestore · 아키텍트 | 미결정 |
| C3 | KPI instrumentation(`pointerInput` / `UITapGestureRecognizer`)이 칩 제스처·스와이프와 충돌. 실패 write도 "저장 성공"으로 카운트. "하단 터치 = 한 손" 가정은 거짓. 셀프 리포트 1탭이 KPI 자체를 오염 | major | 아키텍트 · UX · 데블스 | 미결정 |
| C4 | 3 컬렉션 listener `combine`/`merge`는 doc 변경마다 전체 result set 재emit. `hasPendingWrites` 중 estimated timestamp로 정렬이 뒤집혀 UI 깜빡임. 페이지네이션·`MetadataChanges` 핸들링 명세 부재 | major | UX · Firestore | 미결정 |
| C5 | `clientEventId` 멱등성 보장 로직 없음. 두 디바이스가 동시에 같은 사건을 입력하면 docId가 달라 중복 doc 영구 잔존. v1.1 머지 후보 전엔 통합 일지에 중복 카드 노출 | major | 보안 · Firestore | 미결정 |
| C6 | 음성비서(UC-2.5) 누락이 "한 손 100%" KPI와 모순. UC-2 가치 명제("양손이 비어있지 않다") 자체가 음성 의존. 칩·BottomSheet·키패드로는 80%가 한계 | major | UX · 데블스 | 미결정 |

---

## 2. 관점별 단독 발견

### Firestore 엔지니어
- **C7 `@ServerTimestamp` + 사용자 입력 `startedAt` 충돌** (**blocker**) — SDK는 nil 필드만 서버 시각으로 덮으므로 사용자 입력은 살아남지만, "방금" 칩의 디바이스-서버 시계 skew가 분석 오염. "직전 패턴" 쿼리에서 서버시각·사용자시각이 한 필드에 섞여 정렬·집계 손상. iOS §5는 "별 필드명 사용 필요 시"로 모호하게 회피.
- **C8 composite index v1.1+ 보류** (major→blocker 직전) — soft-delete + `orderBy(startedAt desc)` 쿼리는 인덱스 없으면 `FAILED_PRECONDITION`. "Firebase 프로젝트만 만든다"에 `firestore.indexes.json` 배포가 포함되는지 명시 없음.

### 모바일 아키텍트
- **C9 Repository 시그니처가 두 문서 사이에서 이미 표류** (major) — Kotlin `Flow<T>`·`FirestoreException` vs Swift `AsyncSequence`·`Error?`. 인자 이름·반환 타입·에러 모델 모두 다른데 "시그니처 불변" 선언. 공통 IDL 부재로 v1.1 인터페이스 갱신 시 두 플랫폼 동시 갱신 보장 없음.
- **C10 Min OS 정책 비대칭** (major) — iOS 17(2023) vs Android 8.0(2017). 0~24개월 보호자 디바이스 분포 근거 없고, KPI 한 손 100% 비교가 OS 분포 다르면 무의미.
- **C11 Strict Concurrency 미결정** (minor→major) — Firebase iOS SDK의 `@Sendable` 미정합이 알려진 이슈. Swift 6 켜는 순간 v1 코드 전부가 경고/에러.

### UX / PM
- **C12 "방금 깼어" 추정 자동 채움의 Undo·5초 취소 윈도우 부재** (blocker) — README의 "추정 OK면 1탭 저장"이 자기강화 오류 시작점. 잘못 추정된 잠든 시각이 다음 추정의 입력으로 들어감. 두 문서 모두 Snackbar·Undo 컴포넌트 0건.
- **C13 좌우 스와이프 종류 전환 + 칩 가로 스크롤 제스처 충돌** (major) — BottomSheet 내 `RelativeTimeChipRow`·`AmountChipRow`가 수평 스크롤. 칩 미는 동작을 Pager가 먹음. 미해결 #5 "테스트 필요"로 떠넘겼지만 첫 슬라이스가 이 결정 위에 빌드됨.
- **C14 iOS `@FirestoreQuery`는 ViewModel에서 사용 불가** (minor) — View property wrapper라 View 내에 둬야 함. §3 표가 단일 `HomeViewModel`로 묘사한 부분은 구현 시 View·Observable 모델 분리 재설계 필요.

### 보안 / 프라이버시
- **C15 로컬 SDK 캐시 디스크 암호화 정책 부재** (major) — iOS `NSFileProtectionComplete` 클래스, Android EncryptedFile/StrongBox 한 줄도 없음. 기본 `CompleteUntilFirstUserAuthentication`로 잠금 화면 우회 시 평문 캐시 접근 가능.
- **C16 KPI 메트릭에 PII 흘러갈 통로** (major) — `/users/{uid}/uxMetrics/{sessionId}`에 시각·세션 적재 시 "수유 시각 = 새벽 3시" 같은 아기 패턴 노출. Firestore Cloud Logging·BigQuery export로 자동 흘러감. 시각 정밀도 라운딩·식별자 제거 정책 없음.
- **C17 iOS Privacy Manifest 자체 코드 부분 누락** (minor) — Firebase BoM이 SDK 부분은 제공하나, 자체 코드의 `UserDefaults`·`systemUptime` 등 Required Reasons API 사용 시 `PrivacyInfo.xcprivacy` 자체 작성 책임. 2024년 이후 미선언 시 앱 거부.

### 데블스 어드보킷 (메타 도전)
- **D1 1인 개발자의 iOS+Android 병렬은 둘 다 어설퍼진다** (**blocker**) — 두 문서가 1:1 mirror. 같은 결정을 두 번 적고·두 번 구현·두 번 테스트. 의뢰자가 매일 쓰는 한 플랫폼부터 끝장내야 dogfooding이 의미.
- **D2 "Firestore SDK 캐시까지만" 슬라이스 = 혼자 쓰는 메모장 검증** (**blocker**) — UC-2 핵심 가치(엄마·아빠 동시 기록)가 전부 v1.1+로 빠짐. 시중 앱과 차별화 없음. 최소 Security Rules + 가족 공유까지가 진짜 MVP 경계.
- **D3 익명 Auth는 "링킹 실패 비용을 v1.1에 외주"한 착시** (major) — Apple Sign-In은 SDK 호출 3줄·반나절. 처음부터 실제 Auth가 결국 싸다.
- **D4 KPI를 N=1 dogfooding에서 자체 instrumentation으로 측정** (major) — 통계 무의미. 진짜 측정이 필요해질 v1.1 시점엔 어차피 Analytics 재작성. v1은 instrumentation 빼고 Firebase Analytics 표준 이벤트 1줄만.
- **D5 dev-plan 두 문서 자체가 "다음 회의 예약"** (minor) — 미해결 결정점 13개 < 실제 `FeedingQuickSheet` 스파이크 1일이면 절반 자동 해소. 문서 동결 후 스파이크 먼저가 합리적.

---

## 3. 비판 간 상호작용

- **C1 + D3**: 익명 Auth 위험은 보안·Firestore·데블스가 같은 결론(다른 근거)에 도달. → "처음부터 실제 Auth"가 가장 합의된 해법.
- **C2 + C8 + D2**: 백엔드 미배포 슬라이스의 누적 비판. Security Rules·인덱스·머지 후보를 v1.1로 미룬 결정 자체가 흔들림.
- **C3 + C16 + D4**: KPI 측정 전략 전반에 대한 3중 비판. "측정을 단순화하거나 아예 빼고 표준 Analytics만" 방향이 떠오름.
- **C6 + D2**: 가치 명제("양손이 비어있지 않다"·"가족 공유")가 첫 슬라이스에서 둘 다 빠졌다는 동일 통찰의 다른 각도.
- **D1 + C9 + C10**: 두 플랫폼 병렬이 표류·비대칭·중복을 낳는다는 종합 신호.

---

## 4. 검토 상태 트래커

각 비판에 대한 결정(수용·기각·완화·보류) 미정. 결정 시 본 문서 표의 "검토 상태" 컬럼 갱신 + dev-plan 본 문서에 반영.

가능한 후속 액션 옵션 (참고):
- A. 슬라이스 재정의 — D1·D2·C1·D3 수용 시. iOS 단일 + 실제 Auth + 최소 가족 공유로 축소
- B. blocker만 완화책 추가 — C1·C2·C7 등을 dev-plan에 보강하고 슬라이스 유지
- C. 전체 6개 합의 비판 + 단독 중요 항목 반영 개정
- D. 문서 동결 + `FeedingQuickSheet` 스파이크 먼저 (D5)

---

## 5. 참조

- 시나리오: [README.md](./README.md)
- Android 계획: [dev-plan-android.md](./dev-plan-android.md)
- iOS 계획: [dev-plan-ios.md](./dev-plan-ios.md)
- 데이터 모델: [../_specs/data-model.md](../_specs/data-model.md)
