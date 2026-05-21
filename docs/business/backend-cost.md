# 백엔드 인프라 비용 (Firebase + Kakao Cloud 하이브리드)

> 결정된 스택: **Firebase Firestore + Authentication + Cloud Functions + FCM** + **Kakao Cloud Object Storage (사진·영상 본체 전용)**
> 작성: 2026-05-20 (2026-05-21 Kakao Cloud 분리 결정)
> 데이터 모델: [_specs/data-model.md](../usecase/_specs/data-model.md)

## 0. 저장소 분리 정책 (2026-05-21 결정, Kakao Cloud 채택)

| 데이터 | 저장소 | 사유 |
|---|---|---|
| 일지·아기·가족·LLM 로그·구독 등 메타 | **Firebase Firestore** | 권한 통합, 실시간 listener, Cloud Functions 통합 |
| 사진·영상 본체 | **Kakao Cloud Object Storage** | 한국 데이터 거주성, 세금계산서, NCP -15%, Kakao OAuth·알림톡 시너지 |
| 울음 오디오 (단기) | Firebase Cloud Storage | Cloud Function 트리거 통합, 즉시 폐기 정책 |
| 프로필 아바타·PDF export | Firebase Cloud Storage | 작거나 짧은 TTL |

**단가 가정 (Kakao Cloud, NCP 대비 -15%)**: 저장 ~₩25/GB·월, Egress ~₩85/GB (실제 청구 전 공식 calculator 재확인 필요).

흐름은 Pre-Signed URL 패턴: 클라이언트 ↔ Kakao Cloud 직접 PUT/GET, 권한·메타는 Firestore 경유. 자세한 시퀀스는 [data-model.md §4.13](../usecase/_specs/data-model.md).

---

## 1. Firebase Spark vs Blaze 분기

### Spark (무료)
- Firestore: 1GB 저장 / 50K reads/day / 20K writes/day / 20K deletes/day
- Cloud Storage: 5GB 저장 / 1GB/일 download / 20K uploads/day
- Authentication: 무료 (모든 IdP)
- FCM: 무료 무제한
- Cloud Functions: ❌ (Blaze 필수)

### Blaze (종량제, 무료 한도 그대로 + 초과분만 과금)
- Firestore: $0.06 / 100K reads, $0.18 / 100K writes, $0.02 / 100K deletes
- Cloud Storage: $0.026/GB·월 저장, $0.12/GB egress
- Cloud Functions: $0.40 / 1M invocations + GB-second
- 첫 200만 Functions 호출/월 무료

**전환 트리거**: Cloud Functions 사용 시점에 Blaze 자동 전환 (본 데이터 모델은 Cloud Functions 필수 — `onMembershipChange`, `onLogCreate` 등)

→ **현실적으로 Day 1부터 Blaze** 필요. 단 사용량이 무료 한도 내면 청구액 $0.

---

## 2. 단계별 사용량 추정

본 데이터 모델 ([_specs/data-model.md](../usecase/_specs/data-model.md))의 트래픽 패턴 기준.

### 가족 1팀(멤버 8명·활성 4명)·1일 사용 패턴 (갱신, 2026-05-20)
> 무료 한도 가족 멤버 3명 → 8명 변경, 활성 평균 4명(양가 조부모 일부 활성) 반영.

| 작업 | 빈도 | 영향 |
|---|---|---|
| 일지 작성 (수유·수면·배변) | 35건 | Firestore writes 35 · realtime listener trigger 140 (활성 4명 × 35) |
| 사진 업로드 | 5건 | Storage upload 5 · Functions 5 · listener trigger 20 |
| 울음 분석 | 3건 | Functions 6 · Firestore reads 45 · LLM 호출 3 |
| 갤러리 조회 | 1세션(~40 사진 로드) | Firestore reads 40 · Storage egress 120MB |
| 일지 타임라인 조회 | 4세션 (활성 4명) | Firestore reads ~200 |
| 가족 활동 listener (active 2시간 × 4명) | — | Firestore reads ~500 |
| 푸시 알림 수신 | 15건 | FCM 무료 |
| 광고 노출 (무료 사용자만) | 7건 | AdMob SDK 호출, Firestore 영향 미미 |
| **합계 (가족당 일)** | | **Reads ~830 · Writes ~45 · Storage ~15MB 신규** |

### 스케일별 월 사용량 (가족 단위, DAU 100 = 가족 25팀·활성 4명 가정)
| 단계 | DAU | 가족 수 | Firestore reads/월 | Firestore writes/월 | Storage 누적 (6개월) |
|---|---|---|---|---|---|
| 시드 | 100 | 25 | 0.6M | 34K | 7GB |
| MVP | 1K | 250 | 6.2M | 340K | 70GB |
| Early | 10K | 2.5K | 62M | 3.4M | 700GB |
| Growth | 50K | 12.5K | 310M | 17M | 3.5TB |
| Scale | 100K | 25K | 620M | 34M | 7TB |

---

## 3. Firebase 청구액 추정 (월)

### 3.1 시드 (DAU 100, 25가족 × 활성 4명, 사진 본체 Kakao Cloud)
| 항목 | 사용량 | 단가 | 청구 |
|---|---|---|---|
| Firestore reads | 0.6M (한도 50K/일 = 1.5M 내) | — | $0 |
| Firestore writes | 34K (한도 내) | — | $0 |
| **Firebase Storage (오디오·프로필·PDF only)** | ~1GB (한도 5GB 내) | — | $0 |
| **Kakao Cloud Object Storage (사진·영상)** | 7GB 누적 | ₩25/GB | ₩175 (~$0.13) |
| **Kakao Cloud egress** | ~5GB/월 | ₩85/GB | ₩425 (~$0.32) |
| Cloud Functions | ~70K 호출 (NCP URL 발급 함수 포함, 한도 내) | — | $0 |
| Auth · FCM | 무료 | — | $0 |
| **인프라 합계** | | | **~$0.6/월** |

**현실적으로 시드 단계는 ₩1,000 미만**. 사실상 무료. NCP가 추가됐지만 사용량 적어 영향 미미.

### 3.2 MVP (DAU 1K, 250가족, 사진 본체 Kakao Cloud)
| 항목 | 사용량 | 청구 |
|---|---|---|
| Firestore reads 6.2M | | $3.7 |
| Firestore writes 340K (한도 내) | | $0 |
| Firebase Storage (오디오·프로필) ~10GB | | $0.13 |
| **Kakao Cloud Object Storage (사진·영상) 70GB 누적** | ₩1,750 | $1.3 |
| **Kakao Cloud egress ~50GB/월** | ₩4,250 | $3.2 |
| Cloud Functions ~700K 호출 (한도 내) | | $0 |
| **인프라 합계** | | **~$9~12/월** |

이전 Firebase 단독 ($25/월) 대비 약 60% 감소. NCP 단가가 Firebase Storage보다 약간 비싸지만, **Firebase Storage egress($0.12) → NCP egress(₩100≈$0.075)**로 트래픽 비용 절감이 더 큼.

### 3.3 Early (DAU 10K, 2.5K가족, 사진 본체 Kakao Cloud)
| 항목 | 사용량 | 청구 |
|---|---|---|
| Firestore reads 62M | | ~$37 |
| Firestore writes 3.4M | | ~$6 |
| Firebase Storage (오디오·프로필) ~50GB | | ~$1.5 |
| **Kakao Cloud Object Storage 700GB** | ₩17,500 | ~$13 |
| **Kakao Cloud egress ~500GB/월** | ₩42,500 | ~$32 |
| Cloud Functions ~7M 호출 | | ~$2 |
| **인프라 합계** | | **~$100/월** |

이전 Firebase 단독 ($290/월) 대비 약 65% 감소.

### 3.4 Growth (DAU 50K, 12.5K가족, 사진 본체 Kakao Cloud)
| 항목 | 사용량 | 청구 |
|---|---|---|
| Firestore reads ~310M | | ~$186 |
| Firestore writes ~17M | | ~$30 |
| Firebase Storage (오디오·프로필) ~250GB | | ~$7 |
| **Kakao Cloud Object Storage 3.5TB** | ₩87.5K | ~$65 |
| **Kakao Cloud egress ~2.5TB/월** | ₩212.5K | ~$160 |
| Cloud Functions ~35M 호출 | | ~$15 |
| **인프라 합계** | | **~$500/월** |

이전 Firebase 단독 ($1,460/월) 대비 약 65% 감소. NCP 분리의 누적 효과 큼.

---

## 4. 비용 항목별 우선 절감 전략

### 4.1 Storage egress가 가장 큰 변수 (Growth 단계 41%)
- **Cloudflare R2로 사진 본체 이전 검토** — egress 무료 (월 $600 → $0)
- Growth 단계 진입 시 R2 이전 시점에 약 40% 절감
- 단 Firebase Storage Security Rules는 잃음 (R2는 IAM + 서명 URL로 대체)

### 4.2 Firestore reads 두 번째 변수 (37%)
- **listener 활성 시간 제한** — 백그라운드 진입 시 listener detach
- **페이지네이션 제한** — 일지 타임라인 한 번에 50건 → 30건
- **가족 그룹 부분 구독** — 다른 가족 멤버의 모든 활동 listen 대신, AI 팁만 listen

### 4.3 Cloud Functions 동기 트리거 최소화
- 머지 후보 검색 함수는 onCreate에서 즉시 실행하지 말고 1분 batch 모드 검토 (사용자 즉각 알림 가치 vs 비용)
- 가족 푸시 알림은 Functions 1회로 묶어 발송 (개별 멤버 each 호출 X)

### 4.4 데이터 보존 정책
- `audioDiscardPolicy=DISCARD_IMMEDIATE`로 울음 오디오 즉시 폐기 (Storage 절감 + 프라이버시)
- `cryAnalysisSessions` 90일 후 archive 컬렉션 이동 검토 (Firestore cold storage 미지원이므로 BigQuery export 대안)
- 사진은 사용자 동의 시 24개월 이상 보관, 그 외 cold storage 이전

---

## 5. 한국 사용자·앱인토스 채널 특이사항

### 5.1 Firebase 리전
- Firestore: `asia-northeast3` (Seoul) 선택 가능 → 한국 latency 우위
- Cloud Storage: `asia-northeast3` 동일
- Cloud Functions: `asia-northeast3` 일부 v2 함수 지원 (이전 보다 가용성 향상)

### 5.2 앱인토스(WebView) 환경
- Firebase Web SDK 동작 확인 필요 (Open Question)
- Storage 직접 업로드 가능 (signed URL 또는 token 발급)
- 사진 업로드 시 토스 WebView → Firebase Storage 직접 ≈ egress 비용 동일

### 5.3 토스 푸시
- FCM이 백엔드, 토스 푸시 별도 채널이라면 FCM payload를 토스 푸시 API로 forward하는 Cloud Function 추가 필요
- 토스 푸시 단가 별도 (Open Question)

---

## 6. 비용 모니터링 가드레일 (Day 1부터 적용)

| 가드레일 | 임계값 | 액션 |
|---|---|---|
| 일 Firestore reads | > 100K (시드) / > 1M (MVP) | 이메일 알림 |
| 일 Functions 호출 | > 50K (시드) | 이메일 알림 |
| 일 Storage egress | > 500MB (시드) / > 5GB (MVP) | 이메일 알림 |
| **월 청구액 예산** | $5 (시드) / $50 (MVP) / $500 (Early) | 즉시 알림 + 일시 정지 검토 |

Firebase 콘솔의 Budget Alerts + Cloud Billing 알림으로 설정.

---

## 7. 마이그레이션 옵션 (Growth 단계 검토)

문서 [cloud-cost-comparison.md §10](../usecase/_specs/cloud-cost-comparison.md) 참조.

| 시점 | 추천 |
|---|---|
| DAU 5K~10K | Cloudflare R2로 Storage만 이전 (월 $200~400 절감) |
| DAU 10K+ | Supabase Pro 검토 (Postgres 합의안 활용 가능) — 본격 마이그레이션 |
| KISA ISMS-P 필요 시 | NHN Cloud / NCP — 메인 백엔드 한국 리전으로 |
