# UC-2 Android 구현 계획 (Implementation Plan)

> UC-2 시나리오는 [README.md](./README.md), iOS 구현 계획은 [dev-plan-ios.md](./dev-plan-ios.md), 데이터 모델은 [_specs/data-model.md](../_specs/data-model.md) 참조.
> 최종 갱신: 2026-05-23

본 문서는 **UC-2(수유·수면·배변·통합일지) 시나리오를 Android에서 어떻게 구현할지의 윤곽**을 정의한다. 실제 디렉토리·클래스명·스프린트 단위 작업은 별도 `develop/` 폴더 문서에서 다룬다.

---

## 1. 결정 요약 (2026-05-23)

- **언어/UI**: Kotlin + Jetpack Compose. View System 폴백 없음.
- **데이터**: Firebase Firestore Android SDK(`firebase-firestore-ktx`) 단독. **Room 미사용** (이중 캐시 회피).
- **로컬 캐시**: Firestore SDK 내장 LevelDB persistence(기본 ON). 별도 SQLite/DataStore 큐 없음.
- **백엔드 미연결 슬라이스**: 첫 MVP는 Firebase 프로젝트만 만들고 Cloud Functions·Security Rules·머지 후보·E2E·멤버십은 v1.1+로 미룬다.
- **인증**: 익명(Anonymous) Firebase Auth로 시작. Apple/Google/Kakao/Toss는 v1.1+.
- **음성비서(UC-2.5)**: v1.1+. 본 슬라이스 미포함.

근거: [data-model.md §1, §7.1](../_specs/data-model.md), 본 폴더 [README.md §입력 UX 4원칙](./README.md).

---

## 2. 스택 구성

| 레이어 | 채택 | 사유 |
|---|---|---|
| 언어 | Kotlin 2.0+ | Compose 안정성, K2 컴파일러 |
| UI | Jetpack Compose (Material 3) | Thumb Zone·스와이프·동적 칩 표현이 XML보다 짧음 |
| 상태 | `StateFlow` + `viewModelScope` | Compose `collectAsStateWithLifecycle()`로 단순 바인딩 |
| DI | Hilt | Firestore 인스턴스·Repository 주입 |
| 데이터 | `firebase-firestore-ktx` (BoM 33+) | 자동 오프라인 캐시·실시간 listener |
| 인증 | `firebase-auth-ktx` (Anonymous) | v1.1에서 다른 provider link로 마이그레이션 |
| 비동기 | Kotlin Coroutines + Flow | Firestore의 `.snapshots()` Flow 어댑터 사용 |
| 테스트 | JUnit5 + Compose UI Test + Firestore Emulator | KPI 측정 instrumentation 동반 |

**채택하지 않은 것**: Room, Retrofit, WorkManager(동기화 용도), Realm, Ktor 클라이언트. Firestore SDK가 모두 대체.

---

## 3. UC-2 시나리오 → Android 컴포넌트 매핑

| UC | 화면/컴포넌트 | 상태/Flow | Firestore 경로 |
|---|---|---|---|
| UC-2.1 수유 | `FeedingQuickSheet` (ModalBottomSheet) | `FeedingViewModel.uiState: StateFlow<FeedingFormState>` | `/families/{fid}/feedingLogs` |
| UC-2.2 수면 | `SleepQuickSheet` + "방금 깼어" Home action | `SleepViewModel`, 진행 중 수면은 `wokeUpAt=null` doc 1건 listener | `/families/{fid}/sleepLogs` |
| UC-2.3 배변 | `DiaperQuickSheet` | `DiaperViewModel` + 색상/묽기 아이콘 선택 컴포넌트 | `/families/{fid}/diaperLogs` |
| UC-2.4 통합 일지 | `TimelineScreen` (LazyColumn, 날짜 sticky header) | 3 컬렉션 Flow `combine` → 단일 `List<TimelineItem>` | 3종 컬렉션 동시 listen |
| 홈 | `HomeScreen` (직전 패턴 카드·다음 수유 예상·"방금 OOO" 1탭 버튼 3종) | `HomeViewModel`이 3 컬렉션의 최근 1건씩 구독 | 동일 |

---

## 4. 입력 UX 4원칙 → Compose 구현 패턴

[README.md 입력 UX 4대 원칙](./README.md) 매핑.

### 4.1 Smart Default (직전 입력 자동 미리 선택)
- `Repository.lastFeedingLog(babyId): Flow<FeedingLog?>` — `.limit(1).orderBy(startedAt, DESC)` Flow
- BottomSheet 진입 시 `LaunchedEffect`에서 직전 doc의 `kind`·`amountMl`·메모를 폼 초기값으로 주입
- 사용자가 변경한 필드는 `FormState.touchedFields: Set<FieldKey>`로 추적해 자동 채움 덮어쓰지 않음

### 4.2 상대시각 칩
- `RelativeTimeChipRow(now, onSelect)` Composable. 칩 5개: `방금 / 10분 전 / 30분 전 / 1시간 전 / 직접 선택`
- 칩 1탭 = `startedAt = now - offset`, 즉시 ViewModel 업데이트
- "직접 선택" → Material 3 `TimePickerDialog` (휠이 아닌 키패드 모드 기본)
- **칩이 시각 입력의 80%+ 커버**가 목표 (KPI 측정 대상)

### 4.3 자주쓰는 양 칩
- `AmountChipRow(values = [60, 90, 120, 150, 180], selected, onSelect)`
- 사용자 누적 데이터로 동적 갱신: 최근 30일 mode 5개로 가중. v1.1+
- v1에서는 정적 5개 + "직접 입력" 칩 → `NumericKeyboard` IME 사용 (휠 X)

### 4.4 Thumb Zone + 스와이프
- BottomSheet 높이 = 화면의 55~65% (액션 영역이 모두 하단 1/3에 위치)
- 모든 칩·저장 버튼 최소 터치 영역 60dp (Material 3 권장 48dp보다 큼)
- 종류 전환: `HorizontalPager(3 tabs)` — 수유↔수면↔배변 좌·우 스와이프
- 저장 버튼은 BottomSheet 최하단 sticky FAB-style (단일 버튼, 최대폭)

---

## 5. Firestore 데이터 매핑

[data-model.md §4.7~4.9](../_specs/data-model.md) 기준 Kotlin 모델 정의.

```kotlin
// 공통 베이스 (Composition over inheritance — interface로 표현)
interface SyncableEntity {
  val id: String
  val familyId: String
  val createdAt: Timestamp?
  val updatedAt: Timestamp?
  val deletedAt: Timestamp?
  val version: Int
  val lastEditedBy: String
  val originDeviceId: String
  val originSource: String       // 'MANUAL_UI'|'QUICK_REPEAT'|'VOICE_*'|...
  val clientEventId: String
  val appChannel: String          // 'NATIVE_ANDROID'
}

data class FeedingLog(
  @DocumentId override val id: String = "",
  override val familyId: String = "",
  val babyId: String = "",
  val kind: String = "FORMULA",   // BREAST_LEFT|BREAST_RIGHT|BREAST_BOTH|FORMULA|SOLID
  @ServerTimestamp val startedAt: Timestamp? = null,
  val endedAt: Timestamp? = null,
  val durationMinutes: Int? = null,
  val amountMl: Int? = null,
  val notes: String? = null,
  // 공통 필드 + 기본값
  override val createdAt: Timestamp? = null,
  override val updatedAt: Timestamp? = null,
  // ...
) : SyncableEntity
```

**원칙**:
- enum은 String + 도메인 상수 객체(`object FeedingKind { const val FORMULA = "FORMULA" }`)로 표현. Firestore enum 안정성 ↔ Kotlin 타입 안전성 절충
- `@DocumentId` 로 docId 자동 바인딩, ID는 클라이언트 생성(UUIDv7) 후 `.document(id).set(log)` 패턴
- `@ServerTimestamp` 는 첫 write 시에만 채워짐 — 시각 입력은 별도 `startedAt` 필드로 직접 쓰기

---

## 6. 오프라인 캐시 동작

```kotlin
// Application.onCreate()
val firestore = Firebase.firestore.apply {
  firestoreSettings = firestoreSettings {
    isPersistenceEnabled = true            // 기본 true
    cacheSizeBytes = 100L * 1024 * 1024    // 100MB
  }
}
```

| 시나리오 | SDK 동작 | UI 표현 |
|---|---|---|
| 입력 시 네트워크 OK | 즉시 로컬 캐시 + 서버 write 큐 → `addSnapshotListener`가 `hasPendingWrites=false`로 갱신 | 저장 즉시 일지 카드 등장 |
| 입력 시 오프라인 | 로컬 캐시 즉시 반영, write는 큐에 적재 → 온라인 복귀 시 자동 flush | "동기화 대기 N건" 배지 (v1.1+) |
| 앱 재시작 (오프라인) | LevelDB에서 캐시 복원 | 마지막 본 화면 그대로 |
| Firestore 미연결 (백엔드 슬라이스 미배포) | write는 무한 큐잉 — MVP 검증엔 무해 | UI 상으론 정상 동작 |

**핵심**: write 호출은 `await()` 하지 않고 즉시 반환되는 `.set(log)` 패턴. UI는 listener의 캐시 hit 기반 갱신만 신뢰.

---

## 7. KPI 측정 전략

[README.md 목표 KPI](./README.md) — 입력 1~3탭 / 3~5초 / 한 손 조작 100%.

| KPI | 측정 방법 |
|---|---|
| 입력 탭 수 | BottomSheet 진입~저장 사이 `Modifier.pointerInput`으로 raw down 이벤트 카운트 (디바운스 50ms) |
| 입력 소요 초 | 진입 시각 - 저장 클릭 시각 (`System.currentTimeMillis`) |
| 한 손 조작 비율 | 사용자 셀프 리포트(저장 직후 1탭 토글) + 터치 좌표 분포 분석 (하단 1/3 비율) |
| 칩 적중률 (4.2/4.3) | 칩 1탭 후 저장한 비율 vs 직접 입력 후 저장한 비율 |

수집 데이터는 v1 MVP에서는 **로컬 Firestore subcollection** `/users/{uid}/uxMetrics/{sessionId}`에만 적재. 외부 analytics(Firebase Analytics·GA4)는 v1.1+.

---

## 8. v1.1+ 대비 인터페이스 경계

이번 슬라이스에서 **변경되지 않도록** 고정할 인터페이스:

- `LogRepository` 인터페이스 (`save(log)`, `streamRecent(babyId, limit)`, `streamTimeline(babyId, dayRange)`) — Cloud Functions·머지 후보·E2E가 붙어도 시그니처 불변
- `FormState` 모델 — 음성비서(UC-2.5) Intent도 같은 FormState로 변환 후 동일 save 경로
- `FamilyContext` (`familyId`, `babyId`, `userId`) — 익명 Auth → 실제 Auth 전환 시 값만 바뀌고 구조 동일

**바뀔 것들**:
- Security Rules로 인한 write 실패 처리 — v1.1에서 `SnapshotMetadata.hasPendingWrites` + listener의 `FirestoreException` 분기 추가
- 머지 후보(Cloud Function이 ±2분 검사 후 `syncConflicts` 생성) — listener 추가, UI는 별도 ConflictResolutionSheet
- E2E (BabyMedicalNote 등) — 본 슬라이스 무관

---

## 9. Android 특화 고려사항

- **Edge-to-edge + IME**: BottomSheet가 IME(키보드)와 겹치지 않도록 `WindowInsets.ime` + `imePadding()`. 시각·양 입력 빈도가 높음
- **백그라운드 제약**: 입력 즉시 write는 Foreground에서만 보장. WorkManager 백업은 불필요 — Firestore SDK가 프로세스 재시작 시 자동 재시도
- **다국어 외 우선순위**: `largeTextMode` 지원 (사용자 설정의 글자 크기 따라가기) — Compose는 `Configuration.fontScale` 자동 적용
- **Predictive Back**: BottomSheet 진입 후 미저장 상태에서 뒤로가기 → "임시저장하고 닫기" 다이얼로그(`PredictiveBackHandler`)
- **ProGuard/R8**: Firestore POJO는 `@Keep` 또는 `consumer-rules.pro`에 룰 추가 (Firebase BoM가 제공)
- **Min SDK**: API 26 (Android 8.0) — Firestore KTX BoM 33+ 요구사항과 일치

---

## 10. 미해결 결정점

1. **익명 Auth → 실제 Auth 전환 시 데이터 이전**: 익명 UID로 쌓인 일지를 실제 UID 가족 그룹으로 어떻게 옮길지. `linkWithCredential` + Cloud Function 마이그레이션 함수 필요할 가능성.
2. **가족 그룹 자동 생성 정책**: 첫 실행 시 1인 가족 그룹·기본 babyId를 자동 생성할지, 명시적 온보딩 화면을 강제할지. (UC-4 의존)
3. **동적 양 칩 갱신 알고리즘**: 최근 30일 mode를 자주쓰는양 칩에 반영하는 로직의 가중치·갱신 주기 (v1.1+ 보류)
4. **이벤트 instrumentation 위치**: KPI 측정을 Compose Modifier 레벨로 둘지, ViewModel 레벨로 둘지. 전자는 정확하지만 침습적
5. **HorizontalPager vs SegmentedButton (4.4)**: 종류 전환을 좌우 스와이프로 할지, 상단 세그먼트 버튼으로 할지. 실측 사용성 테스트 필요
6. **Compose Multiplatform 도입 여지**: iOS 문서와의 코드 중복이 심해지면 Compose Multiplatform로 통합 가능 — 단 v2 안건

---

## 11. 참조

- 시나리오: [README.md](./README.md)
- iOS 구현 계획: [dev-plan-ios.md](./dev-plan-ios.md)
- 데이터 모델: [../_specs/data-model.md](../_specs/data-model.md)
- 메인 시나리오: [../main-scenario.md](../main-scenario.md)
- 실제 개발 디테일(예정): `develop/uc-2-android/`
