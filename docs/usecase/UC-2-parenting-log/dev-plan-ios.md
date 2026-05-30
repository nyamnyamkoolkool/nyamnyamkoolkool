# UC-2 iOS 구현 계획 (Implementation Plan)

> UC-2 시나리오는 [README.md](./README.md), Android 구현 계획은 [dev-plan-android.md](./dev-plan-android.md), 데이터 모델은 [_specs/data-model.md](../_specs/data-model.md) 참조.
> 최종 갱신: 2026-05-23

본 문서는 **UC-2(수유·수면·배변·통합일지) 시나리오를 iOS에서 어떻게 구현할지의 윤곽**을 정의한다. 실제 디렉토리·타입명·스프린트 단위 작업은 별도 `develop/` 폴더 문서에서 다룬다.

---

## 1. 결정 요약 (2026-05-23)

- **언어/UI**: Swift 5.9+ + SwiftUI. UIKit 폴백 없음(필요 시 `UIViewRepresentable` 한정).
- **상태**: `@Observable` 매크로(iOS 17+) + `Environment`. 기존 `ObservableObject`/`@Published`는 신규 코드에서 미사용.
- **데이터**: Firebase Firestore iOS SDK(SPM) 단독. **SwiftData·Core Data 미사용** (이중 캐시 회피).
- **로컬 캐시**: Firestore SDK 내장 SQLite persistence(기본 ON).
- **백엔드 미연결 슬라이스**: 첫 MVP는 Firebase 프로젝트만 만들고 Cloud Functions·Security Rules·머지 후보·E2E·멤버십은 v1.1+로 미룬다.
- **인증**: 익명(Anonymous) Firebase Auth로 시작. Apple/Google/Kakao/Toss는 v1.1+.
- **음성비서(UC-2.5)**: v1.1+. App Intents 통합은 본 슬라이스 미포함.
- **최소 OS**: iOS 17.0. `@Observable` 매크로와 `@FirestoreQuery` 최신 API 요구.

근거: [data-model.md §1, §7.1](../_specs/data-model.md), 본 폴더 [README.md §입력 UX 4원칙](./README.md).

---

## 2. 스택 구성

| 레이어 | 채택 | 사유 |
|---|---|---|
| 언어 | Swift 5.9+ | Observation 매크로, Strict Concurrency |
| UI | SwiftUI (iOS 17+) | NavigationStack, `.sheet(presentationDetents:)`, Observation 통합 |
| 상태 | `@Observable` + `@Environment` | `ObservableObject`보다 갱신 입도 세밀, 보일러플레이트 감소 |
| DI | `Environment` + factory closure | 외부 DI 라이브러리(Swinject/Factory) 미도입 |
| 데이터 | `FirebaseFirestore` (SPM, BoM 11+) | Codable 지원, `addSnapshotListener`, `@FirestoreQuery` |
| 인증 | `FirebaseAuth` (Anonymous) | v1.1에서 `link(with:)`로 provider 연결 |
| 비동기 | `async/await` + `AsyncSequence` | 콜백 API는 `Continuation`으로 브리지 |
| 테스트 | Swift Testing(`@Test`) + ViewInspector + Firestore Emulator | iOS 17의 새 테스트 프레임워크 우선 |

**채택하지 않은 것**: SwiftData, Core Data, Realm, Alamofire, Moya. Firestore SDK가 모두 대체.

---

## 3. UC-2 시나리오 → iOS 컴포넌트 매핑

| UC | 화면/컴포넌트 | 상태 모델 | Firestore 경로 |
|---|---|---|---|
| UC-2.1 수유 | `FeedingQuickSheet` (`.sheet` + `.presentationDetents([.medium])`) | `@Observable class FeedingFormModel` | `/families/{fid}/feedingLogs` |
| UC-2.2 수면 | `SleepQuickSheet` + Home "방금 깼어" 버튼 | `SleepFormModel`, 진행 중 수면은 `wokeUpAt == nil` doc 1건 구독 | `/families/{fid}/sleepLogs` |
| UC-2.3 배변 | `DiaperQuickSheet` | `DiaperFormModel` + SF Symbols 색상/묽기 아이콘 | `/families/{fid}/diaperLogs` |
| UC-2.4 통합 일지 | `TimelineView` (`List` + `Section` per 날짜) | 3 `AsyncSequence` `merge()` → `[TimelineItem]` | 3종 컬렉션 동시 구독 |
| 홈 | `HomeView` (직전 패턴 카드·다음 수유 예상·"방금 OOO" 1탭 버튼 3종) | `HomeViewModel`이 3 컬렉션의 최근 1건씩 `@FirestoreQuery`로 구독 | 동일 |

---

## 4. 입력 UX 4원칙 → SwiftUI 구현 패턴

[README.md 입력 UX 4대 원칙](./README.md) 매핑.

### 4.1 Smart Default (직전 입력 자동 미리 선택)
- `Repository.lastFeedingLog(babyId:)` → `AsyncSequence<FeedingLog?>` (Firestore `addSnapshotListener` 브리지)
- Sheet 진입 시 `.task { ... }` 에서 직전 doc 1건을 받아 `FormModel`에 주입
- 사용자 변경 추적: `FormModel.touchedFields: Set<FieldKey>` — 자동 채움이 사용자 입력을 덮어쓰지 않게 가드

### 4.2 상대시각 칩
- `RelativeTimeChipRow(now:onSelect:)` View. 칩 5개: `방금 / 10분 전 / 30분 전 / 1시간 전 / 직접 선택`
- "직접 선택" → `DatePicker(displayedComponents: .hourAndMinute)` with `.compact` 스타일 (휠이 아닌 키패드 우선)
- 칩 1탭 = `startedAt = .now - offset`, `@Observable` 모델 즉시 변경 → 뷰 자동 갱신
- **칩이 시각 입력의 80%+ 커버**가 목표 (KPI 측정 대상)

### 4.3 자주쓰는 양 칩
- `AmountChipRow(values: [60, 90, 120, 150, 180], selected: $amount)`
- 동적 갱신(최근 30일 mode 5개)은 v1.1+. v1은 정적 5개 + "직접 입력" 칩
- "직접 입력" 활성 시 `TextField` + `.keyboardType(.numberPad)` (휠 X)

### 4.4 Thumb Zone + 스와이프
- Sheet height: `.presentationDetents([.fraction(0.6)])` — 액션 영역이 화면 하단 1/3에 고정
- 모든 칩·저장 버튼 최소 터치 영역 60pt (HIG 권장 44pt보다 큼)
- 종류 전환: `TabView` + `.tabViewStyle(.page(indexDisplayMode: .never))` — 수유↔수면↔배변 좌·우 스와이프
- 저장 버튼은 Sheet 최하단 sticky (최대폭, `.controlSize(.large)`)

---

## 5. Firestore 데이터 매핑

[data-model.md §4.7~4.9](../_specs/data-model.md) 기준 Swift 모델 정의.

```swift
// 공통 베이스 (프로토콜)
protocol SyncableEntity: Codable, Identifiable {
  var id: String { get }
  var familyId: String { get }
  var createdAt: Timestamp? { get }
  var updatedAt: Timestamp? { get }
  var deletedAt: Timestamp? { get }
  var version: Int { get }
  var lastEditedBy: String { get }
  var originDeviceId: String { get }
  var originSource: String { get }       // "MANUAL_UI"|"QUICK_REPEAT"|"VOICE_*"|...
  var clientEventId: String { get }
  var appChannel: String { get }          // "NATIVE_IOS"
}

struct FeedingLog: SyncableEntity {
  @DocumentID var id: String?
  var familyId: String
  var babyId: String
  var kind: FeedingKind = .formula        // 도메인 enum (String raw)
  @ServerTimestamp var startedAt: Timestamp?
  var endedAt: Timestamp?
  var durationMinutes: Int?
  var amountMl: Int?
  var notes: String?
  // 공통 필드...
  var createdAt: Timestamp?
  var updatedAt: Timestamp?
  // ...
}

enum FeedingKind: String, Codable, CaseIterable {
  case breastLeft = "BREAST_LEFT"
  case breastRight = "BREAST_RIGHT"
  case breastBoth = "BREAST_BOTH"
  case formula = "FORMULA"
  case solid = "SOLID"
}
```

**원칙**:
- enum은 `String` raw + Firestore 원본 값과 1:1. Swift는 enum 안전성, Firestore는 String 유연성 양립
- `@DocumentID`로 docId 자동 바인딩. ID는 클라이언트 생성(UUIDv7) 후 `db.collection(...).document(id).setData(from: log)` 패턴
- `@ServerTimestamp`는 첫 write 시 채워짐. 사용자 입력 `startedAt`은 별도 필드로 직접 set (서버 타임스탬프 덮어쓰지 않게 모델 분리 필요 시 별 필드명 사용)

---

## 6. 오프라인 캐시 동작

```swift
// AppDelegate.application(_:didFinishLaunchingWithOptions:) 또는 @main App init
FirebaseApp.configure()
let settings = FirestoreSettings()
settings.isPersistenceEnabled = true            // 기본 true
settings.cacheSizeBytes = 100 * 1024 * 1024     // 100MB
Firestore.firestore().settings = settings
```

| 시나리오 | SDK 동작 | UI 표현 |
|---|---|---|
| 입력 시 네트워크 OK | 즉시 로컬 캐시 + 서버 write 큐 → snapshot listener가 `hasPendingWrites == false`로 갱신 | 저장 즉시 일지 카드 등장 |
| 입력 시 오프라인 | 로컬 캐시 즉시 반영, write는 큐에 적재 → 온라인 복귀 시 자동 flush | "동기화 대기 N건" 배지 (v1.1+) |
| 앱 재시작 (오프라인) | SQLite에서 캐시 복원 | 마지막 본 화면 그대로 |
| Firestore 미연결 (백엔드 슬라이스 미배포) | write는 무한 큐잉 — MVP 검증엔 무해 | UI 상으론 정상 동작 |

**핵심**: write 호출은 `try await` 의 완료를 기다리지 않고 fire-and-forget 패턴. UI는 listener의 캐시 hit 기반 갱신만 신뢰. (`setData(from:)`은 동기 메서드처럼 동작 — 콜백은 서버 도달 확인용)

---

## 7. KPI 측정 전략

[README.md 목표 KPI](./README.md) — 입력 1~3탭 / 3~5초 / 한 손 조작 100%.

| KPI | 측정 방법 |
|---|---|
| 입력 탭 수 | Sheet 진입~저장 사이 `UITapGestureRecognizer`(`UIViewRepresentable`)로 raw tap 카운트, 디바운스 50ms |
| 입력 소요 초 | 진입 시각 - 저장 클릭 시각 (`Date()` diff) |
| 한 손 조작 비율 | 사용자 셀프 리포트(저장 직후 1탭 토글) + 터치 좌표 분포(하단 1/3 비율) |
| 칩 적중률 (4.2/4.3) | 칩 1탭 후 저장 비율 vs 직접 입력 후 저장 비율 |

수집 데이터는 v1 MVP에서는 **로컬 Firestore subcollection** `/users/{uid}/uxMetrics/{sessionId}`에만 적재. Firebase Analytics·MetricKit 통합은 v1.1+.

---

## 8. v1.1+ 대비 인터페이스 경계

이번 슬라이스에서 **변경되지 않도록** 고정할 인터페이스:

- `LogRepository` 프로토콜 (`save(_:)`, `streamRecent(babyId:limit:)`, `streamTimeline(babyId:dayRange:)`) — Cloud Functions·머지 후보·E2E가 붙어도 시그니처 불변
- `FormModel` 인터페이스 — App Intents(UC-2.5)도 같은 FormModel로 변환 후 동일 save 경로
- `FamilyContext` (`familyId`, `babyId`, `userId`) — 익명 Auth → 실제 Auth 전환 시 값만 바뀌고 구조 동일

**바뀔 것들**:
- Security Rules로 인한 write 실패 처리 — v1.1에서 `SnapshotMetadata.hasPendingWrites` + listener의 `error: Error?` 분기 추가
- 머지 후보 처리 — listener 추가, UI는 별도 `ConflictResolutionSheet`
- E2E (BabyMedicalNote 등) — 본 슬라이스 무관

---

## 9. iOS 특화 고려사항

- **Privacy Manifest** (`PrivacyInfo.xcprivacy`): Firebase 11+ BoM이 자체 manifest 제공. 자체 코드에서 `UserDefaults` 등 Required Reasons API 사용 시 추가 선언 필요
- **App Tracking Transparency**: 익명 분석만 사용하므로 ATT 프롬프트 불필요. v1.1+ Firebase Analytics 도입 시 검토
- **Background Modes**: 입력 즉시 write만 사용. Background Fetch·Remote Notification 미사용(v1.1+ FCM 도입 시 추가)
- **Dynamic Type**: SwiftUI 기본 지원. `largeTextMode` 사용자 설정은 `.dynamicTypeSize(...)` 환경으로 override
- **Safe Area + 키보드**: `.scrollDismissesKeyboard(.interactively)` + `ignoresSafeArea(.keyboard)` 적절히. 시각·양 입력 빈도가 높음
- **Sheet Detents**: `.presentationDetents([.fraction(0.6), .large])` + `.presentationDragIndicator(.visible)`. 한 손 조작 우선
- **Min OS = iOS 17**: `@Observable` 매크로, `@FirestoreQuery`, `.scrollDismissesKeyboard`, `ContentUnavailableView` 모두 17 이상 요구. iOS 16 폴백 없음(대신 16 디바이스는 미지원 안내)
- **App Intents**: 본 슬라이스 미포함이나, v1.1+ 도입 시 `LogFeedingIntent: AppIntent`로 `FormModel.save()`를 그대로 호출 — 인터페이스 경계만 유지하면 됨

---

## 10. 미해결 결정점

1. **익명 Auth → 실제 Auth 전환 시 데이터 이전**: 익명 UID로 쌓인 일지를 실제 UID 가족 그룹으로 어떻게 옮길지. `link(with:)` + Cloud Function 마이그레이션 함수 필요할 가능성.
2. **가족 그룹 자동 생성 정책**: 첫 실행 시 1인 가족 그룹·기본 babyId를 자동 생성할지, 명시적 온보딩 화면을 강제할지. (UC-4 의존)
3. **동적 양 칩 갱신 알고리즘**: 최근 30일 mode를 자주쓰는양 칩에 반영하는 로직의 가중치·갱신 주기 (v1.1+ 보류)
4. **이벤트 instrumentation 위치**: KPI 측정을 View 레벨(UIViewRepresentable)로 둘지, FormModel 레벨로 둘지. 전자는 정확하지만 SwiftUI 패러다임 벗어남
5. **TabView vs Picker (4.4)**: 종류 전환을 좌우 스와이프(TabView)로 할지, 상단 Segmented Picker로 할지. 실측 사용성 테스트 필요
6. **Strict Concurrency 도입 시점**: Swift 6의 strict concurrency를 v1부터 켤지, v1.1+로 미룰지. Firebase SDK의 actor isolation 호환 상태 모니터링 필요
7. **iOS 16 지원 요구 발생 시**: `@Observable`을 `ObservableObject`로 다운그레이드하는 비용 — 본 문서는 17+ 가정

---

## 11. 참조

- 시나리오: [README.md](./README.md)
- Android 구현 계획: [dev-plan-android.md](./dev-plan-android.md)
- 데이터 모델: [../_specs/data-model.md](../_specs/data-model.md)
- 메인 시나리오: [../main-scenario.md](../main-scenario.md)
- 실제 개발 디테일(예정): `develop/uc-2-ios/`
