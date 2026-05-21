# 클라우드 인프라 비용·운영성 비교

> 데이터 모델 합의안([_specs/data-model.md](./data-model.md)) 기준으로 적용 가능한 클라우드 후보별 비용·운영성 비교.
> 작성: 2026-05-20.
> 주의: 모든 가격은 작성 시점 추정. 실제 견적은 각 클라우드의 공식 calculator로 재검증 필요.

---

## 📌 결정 완료 (2026-05-21 갱신, 사용자 결정)

**채택 스택 (하이브리드, 2026-05-21 최종 결정)**:
- **Firebase Firestore + Authentication + Cloud Functions + FCM** — 모든 메타·일지·LLM 로그·구독
- **Kakao Cloud Object Storage** — 사진·영상 본체만 (한국 데이터 거주성 + 세금계산서 + NCP -15% + Kakao 시너지)
- Firebase Cloud Storage — 울음 오디오(단기)·프로필 아바타·PDF export

**채택 사유 (Kakao Cloud)**:
- 빅4급 신뢰성 (카카오엔터프라이즈 운영)
- NCP/NHN 대비 ~15% 저렴 (저장 ~₩25/GB, Egress ~₩85/GB)
- 카카오엔터프라이즈 명의 세금계산서 매월 15일까지 자동 발행 (NCP/NHN과 동등)
- **Kakao OAuth·카카오톡 알림톡 시너지** — 가족 초대 viral 채널과 결합 (CAC 효율 ↑)
- ISO/IEC 인증 풍부 (2026·2028 만료)
- 향후 KISA ISMS-P 필요 시점에 NCP/NHN으로 부분 이전 검토 (DAU 5만 이상)

**채널 분리 (2026-05-21 결정)**:
- 네이티브 앱: 풀 기능 (일지 + 울음 + 사진 + 음성비서 + 가족 갤러리)
- **앱인토스: 일지 + AI 울음분석 + 아기 정보까지만, 사진은 네이티브 앱 설치 유도 CTA**
- 데이터 모델은 Firestore-native로 재설계 ([data-model.md](./data-model.md) v2)
- 이전 Postgres 합의안은 [_drafts/data-model-postgres-v1.md](./_drafts/data-model-postgres-v1.md) 참고용 보관
- 채택 사유: DAU 100 시드 단계 Firebase Spark 무료 한도 활용 + MVP 진입 속도 + Firebase Auth/FCM/Realtime 통합
- 본 문서의 다른 후보(AWS·NCP·Supabase 등)는 향후 마이그레이션 검토 시 참고 자료로 보존

### Firebase 단계별 추정 비용
| 단계 | DAU | Firebase 플랜 | 월 예상 |
|---|---|---|---|
| 시드 | ≤100 | Spark (무료) | **$0** (한도 내) |
| MVP | 100~1K | Spark → Blaze 자동 전환 시점 모니터링 | $0~30 |
| Early | 1K~10K | Blaze 종량제 | $30~200 |
| Growth | 10K~50K | Blaze + Firestore 비용 폭증 주의 | $500~2,000 |

### Firebase 비용 폭증 주의 영역 (Growth 단계)
1. **Firestore read 과금**: 실시간 listener × 활성 시간 × 변경 빈도. 가족당 3개 listener × 3시간 활성 × 분당 갱신 = 가족당 일 5,400 reads → 만 가족 시 일 5,400만 reads → 월 ~$100
2. **Cloud Storage egress**: 갤러리 트래픽. 1GB egress = $0.12. 사진 본격 사용 시 월 1TB+ → $120+
3. **Cloud Functions 호출**: LLM 호출당 함수 1회 + 트리거 함수 다수 = 호출당 ~$0.0001 + GB-초 과금
4. **대안**: Growth 단계 진입 시 **Cloud Storage → Cloudflare R2 분리 검토** (egress 무료 차이로 월 $100+ 절감)

---

## 1. 워크로드 프로파일 (비용 결정 인자)

본 합의안의 데이터 모델이 클라우드 선택에 미치는 영향.

| 인자 | 본 데이터 모델 특성 | 비용 영향 |
|---|---|---|
| **DBMS 기능 의존** | UUIDv7 PK / **PostgreSQL RLS** / JSONB / 도메인 enum / partial unique / 폴리모픽 FK / `server_seq` 단조 시퀀스 / GIN 인덱스 | **PostgreSQL 호환 필수**. 문서 DB(Firestore)는 임피던스 미스매치 큼 |
| **객체 스토리지 비중** | 사진·영상이 트래픽 80%+ 예상. 가족당 사진 100장/월 × 평균 3MB | **Storage 단가 + Egress 단가**가 총비용의 50%+ 차지 |
| **E2E 암호화** | 사진 본문·캡션·EXIF·BabyMedicalNote는 ciphertext만 저장 | 서버측 검색·트랜스코딩 불가 → 클라우드 부가서비스(이미지 리사이즈/검색) 가치 ↓ |
| **실시간 동기화** | 가족 그룹 단위 (보통 3~5명). 일지 신규 row 시 즉시 푸시 | 가족당 동시 연결 ≤5. WebSocket·Realtime DB 비용은 작음 |
| **오프라인 큐** | 디바이스 SoT, 서버는 멱등 수신만 | 큐 인프라 불요. DB Insert API만 필요 |
| **푸시 알림** | APNs/FCM/토스 푸시 | FCM 무료 · APNs 무료 · 토스 푸시 정책 의존 |
| **LLM 호출** | 외부 API (Gemini/OpenAI/Anthropic) | **인프라 비용과 분리**. 클라우드 선택에 영향 없음 |
| **개인정보 / 의료 데이터** | BabyMedicalNote, 사진(아기 얼굴), 음성 발화 | **한국 개인정보보호법** 국외이전 제한·민감정보 동의 강화 |
| **앱인토스 채널** | 한국 사용자 100%. latency 한국 리전 < 50ms 권장 | **한국 리전(Seoul) 필수** 또는 가까운 일본 리전(Tokyo) |

**스케일 가정**

| 단계 | 사용자 규모 | 가족당 활성 멤버 | 사진/월 (가족당) | DB row/일 (가족당) | LLM 호출/일 (가족당) |
|---|---|---|---|---|---|
| MVP | DAU 200 (가족 200) | 3 | 80장 (240MB) | 25 | 2 |
| Early | DAU 2K (가족 2K) | 3 | 80장 | 25 | 3 |
| Growth | DAU 20K (가족 20K) | 4 | 100장 (300MB) | 30 | 5 |
| Scale | DAU 100K (가족 100K) | 4 | 100장 | 35 | 6 |

---

## 2. 후보 클라우드 매트릭스

### 2.1 PostgreSQL 호환 후보 (본 모델과 정합)

| 후보 | 강점 | 약점 | 한국 리전 | 추천 단계 |
|---|---|---|---|---|
| **Supabase** | Postgres + RLS + Auth + Realtime + Edge Functions + Storage 통합. RLS 1급 시민. 가장 빠른 구현 | Tokyo만 (Seoul 없음, latency ~50ms). 큰 스토리지는 별도 분리 권장 | ❌ Tokyo | MVP·Early |
| **AWS RDS PostgreSQL** + S3 + Cognito + Lambda | 성숙·유연·Seoul 리전. 운영 도구 풍부 | 운영 부담 큼. Realtime은 AppSync/IoT Core 별도 구축 | ✅ Seoul (ap-northeast-2) | Growth·Scale |
| **AWS Aurora Serverless v2** | Postgres 호환 + 오토스케일. 트래픽 변동 대응 | 최소 ACU 0.5(시간 ~$0.06) → 미사용 시간에도 비용 | ✅ Seoul | Early·Growth |
| **GCP Cloud SQL for PostgreSQL** + Cloud Storage + Firebase Auth + FCM + Cloud Functions | Firebase Auth/FCM/Functions 친화. Seoul 리전 | RDS 대비 메니지드 도구 약함 | ✅ Seoul (asia-northeast3) | Early·Growth |
| **Naver Cloud (NCP) Cloud DB for PostgreSQL** + Object Storage + Cloud Functions | **한국 데이터 거주성**·KISA ISMS·개보법 대응·세금계산서. 가격 경쟁력 | 글로벌 확장성 제한. Realtime/Auth 별도 구축 | ✅ Seoul (자국) | 한국 규제 우선 시 전 단계 |
| **Cloudflare D1** (SQLite 기반) + R2 + Workers + Durable Objects | **R2 egress 무료** (갤러리 앱 결정적). 전 세계 엣지 | D1은 아직 베타스러움. SQLite 스키마라 PostgreSQL 함수 일부 미지원 | ✅ 엣지(한국 PoP) | 보조 (R2만 사용 권장) |
| **Neon** (Serverless Postgres) | 0초 콜드 스타트 가능, branching | 한국 리전 없음(`ap-southeast-1`/SG가 최근접) | ❌ | MVP |

### 2.2 비 PostgreSQL 후보 (재설계 필요)

| 후보 | 강점 | 비용·운영 | 본 모델과의 적합도 |
|---|---|---|---|
| **Firebase Firestore + Storage + Auth + FCM** | 가장 빠른 MVP·Realtime 1급 | Read/Write per-op 과금. 가족 그룹 단위 RLS는 Security Rules로 표현 가능 | **재설계 필요**. RLS·JSONB·복잡 인덱스·UUIDv7 등 모델 가정이 깨짐. **권장 X** |
| **AWS DynamoDB** | 무한 스케일 | 액세스 패턴별 GSI 설계 필요. 본 모델의 다양한 쿼리(타임라인·달력·통계)에 부적합 | **권장 X** |
| **MongoDB Atlas** | 문서 모델·Seoul 리전 | RLS 직접 구현. JSONB 일부 패턴은 자연스럽지만 RDBMS 트랜잭션이 약함 | 보조 후보 |

### 2.3 한국 클라우드 상세 (국내 빅4 + 보조)

본 프로젝트는 Firebase 채택이지만, **마이그레이션 후보·부분 활용·KISA ISMS-P 트랙**으로서 한국 클라우드 옵션을 정리.

#### 한국 빅4 — VM 4vCore·16GB 월 정가 (2026년 5월 시점 정찰가)
| CSP | 4vCPU·16GB VM | 강점 | 약점 | 대표 사용처 |
|---|---|---|---|---|
| **Naver Cloud (NCP)** | ~₩182K | 자체 LLM(HyperCLOVA X)·금융·공공·의료 특화. 라인업 풍부 | 글로벌 리전 제한 | 네이버페이·라인 계열, 공공기관 |
| **NHN Cloud** (구 TOAST) | ~₩202K | 공공·게임 특화. CDN·미디어 강점. 한게임 인프라 출신 | UI/문서가 다소 산만 | 한게임·페이코·공공 |
| **Kakao Cloud** (Kakao Enterprise) | **타사 대비 15% 저렴** | 카카오톡·카카오 인증 친화. ISO/IEC 인증 유효 (2026·2028) | 2023 출시 신규, 라인업 한정 | 카카오톡 비즈니스 |
| **KT Cloud** | ~₩224K (최고가) | 공공·금융 1위. 데이터센터 가장 많음. 통신사 망 우위 | 가격 가장 높음, 라인업이 엔터프라이즈 중심 | 정부·금융기관 |

#### 한국 빅4 외 후보
| CSP | 형태 | 강점 | 본 프로젝트 적합성 |
|---|---|---|---|
| **Samsung SDS Cloud (Brity Cloud)** | 엔터프라이즈 PaaS | 삼성 그룹 IT 통합·금융망 | 가격 가장 비쌈, MVP/시드 부적합 |
| **Gabia (가비아)** | 호스팅 → 클라우드 | 도메인·SSL·메일 통합. 중소 가성비 | 부수 인프라(도메인·메일)에 활용 가능 |
| **Cafe24** | 호스팅 + 클라우드 | 쇼핑몰 인프라 출신, e-커머스 친화 | 본 프로젝트와 매칭 약함 |
| **iwinv (스마일서브)** | 가성비 IDC·VPS | VM 월 ~₩10K부터, 코스트 최강 | MVP의 단순 서버 또는 백업 NAS 용도 |
| **Smileserv** | 호스팅 | 24/7 한국어 지원 | 보조 서버·DNS |
| **NIPA K-PaaS** | 정부 지원 클라우드 | 공공기관 대상 무료/지원금 | 스타트업 지원사업 신청 시 활용 |

#### 본 프로젝트(Firebase 결정) 관점에서 한국 클라우드 활용 시나리오

| 시나리오 | 활용 후보 | 활용 방식 |
|---|---|---|
| **KISA ISMS-P 인증 필요해질 때** (DAU 5만+ 또는 매출 100억+) | NHN Cloud / KT Cloud (공공기관용) | 메인 백엔드 마이그레이션. **Firestore → Cloud DB for PostgreSQL** 재설계 필요 |
| **개보법 강화 대응 — 데이터 거주성 의무화** | Naver Cloud / KT Cloud | 사진·민감정보(BabyMedicalNote)만 한국 리전 Object Storage로 부분 이전, Firebase Functions는 유지 |
| **백업·재해복구 (DR) 사이트** | iwinv / Gabia / NCP Cold Storage | Firebase 데이터 일 1회 export → 한국 Object Storage 보관 (월 ₩수천~수만원) |
| **카카오톡 알림톡·친구 초대 viral 강화** | Kakao Cloud + Kakao Business API | 가족 초대 SMS/카카오톡 발송에 카카오톡 채널 사용. Cloud 자체보다 메시지 API 가치 |
| **스타트업 지원사업·정부 크레딧** | NIPA K-PaaS / NCP 창업 지원 / KT Cloud 스타트업 프로그램 | Firebase Blaze 전환 직전(DAU 1K~5K) 시점에 한국 클라우드 크레딧 받아 Growth 비용 절감 |
| **토스 미니앱 사용자 비중 50%+** | Naver Cloud / NHN Cloud | 한국 사용자 latency 우위 + 토스와 같은 KR 사업자 정합. Functions만 한국 리전으로 부분 이전 |

#### 한국 클라우드 채택 시 trade-off (Firebase 대비)
- **잃는 것**: Firestore Realtime listener · Firebase Auth IdP 통합 · FCM 무료 · `npm install firebase` 한 줄
- **얻는 것**: 데이터 거주성 · 세금계산서 · 한국어 SLA · KISA 인증 · 정부 크레딧 · 스타트업 지원
- **결론**: **시드~Early 단계에선 Firebase 유지가 압도적**. Growth 진입 + 인증·규제 요구 발생 시 NHN Cloud 또는 NCP가 1순위. KT Cloud는 공공/금융 비중 큰 사업 외엔 비용 부담.

---

### 2.4 객체 스토리지 단가 비교 (사진·영상 본체)

가장 중요한 비용 항목. **저장 단가 vs Egress 단가**.

| 서비스 | 저장 ($/GB·월) | Egress ($/GB) | 비고 |
|---|---|---|---|
| AWS S3 Standard (Seoul) | $0.025 | $0.126 (Seoul → Internet) | 첫 100GB는 $0.114 |
| AWS S3 Standard-IA | $0.0138 | $0.126 + 검색 비용 | 30일 이상 보관 사진에 |
| GCP Cloud Storage Standard (Seoul) | $0.020 | $0.12 | |
| NCP Object Storage | **₩30/GB ≈ $0.022** | **₩100/GB ≈ $0.075** | 국내 트래픽 단가 ↓ |
| **Cloudflare R2** | $0.015 | **$0 (무료)** | **갤러리 앱 결정적 이점** |
| Supabase Storage | $0.021 | $0.09 (Pro) | Postgres와 통합 |
| Backblaze B2 | $0.006 | $0.01 (Cloudflare 경유 시 $0) | 가장 저렴, 단 한국 PoP 약함 |

→ **결론**: 사진 저장은 **Cloudflare R2** 또는 **NCP Object Storage**가 비용 최적. R2가 글로벌·무료 egress로 유리하지만 한국 데이터 거주성 요구면 NCP.

---

## 3. 시나리오별 월 비용 추정

> 모든 수치는 추정. 사용량·할인·약정·리저브드 인스턴스에 따라 ±50% 변동.

### 3.1 MVP (DAU 200, 가족 200)
- DB: ~5GB, 일지 row 5K/일, 동시 연결 ≤50
- Storage: 누적 50GB → 6개월 후 300GB
- LLM 호출: 400/일 → 12K/월 (외부 비용 별도)

| 옵션 | DB | Storage | Auth/Realtime/Functions | 총 (월) |
|---|---|---|---|---|
| **Supabase Free + Cloudflare R2** | $0 (500MB 한도 초과 → Pro $25 권장) | $0 (10GB 무료) → 300GB 시 $4.5 | 포함 | **$0~$30** |
| Firebase Spark | 1GB 무료 | 5GB 무료 → 초과 시 Blaze | FCM 무료 | $0 (한도 내) |
| NCP Compact | ~₩50K | ~₩9K (300GB) | Cloud Functions ~₩5K | **~₩70K (~$50)** |

**권장 MVP 스택**: Supabase Pro ($25) + Cloudflare R2 (사진만) ≈ **월 $30** + 도메인·SSL 별도.

### 3.2 Early (DAU 2K, 가족 2K)
- DB: ~50GB
- Storage: 6개월 후 누적 ~3TB
- 동시 연결 평균 ~200
- LLM 호출: 6K/일 → 180K/월

| 옵션 | DB | Storage (3TB) | Egress (월 1TB) | 합계 (월) |
|---|---|---|---|---|
| **Supabase Pro + Cloudflare R2** | $25 (8GB 포함, 50GB는 +$10) | R2 $45 (3TB × $0.015) | **$0** | **~$80** |
| GCP Cloud SQL db-g1-small + Cloud Storage (Seoul) | ~$50 | $60 (3TB × $0.02) | $120 (1TB × $0.12) | **~$230** |
| AWS RDS db.t4g.small + S3 Standard (Seoul) | ~$30 | $75 (3TB × $0.025) | $126 (1TB × $0.126) | **~$230** |
| NCP Compact + Object Storage | ~₩100K ($75) | ₩90K ($65) | ₩100K ($75) | **~$215 (~₩290K)** |

**권장**: Supabase Pro + R2 가 압도적. R2 egress 무료로 갤러리 트래픽 비용 차단.

### 3.3 Growth (DAU 20K, 가족 20K)
- DB: ~500GB
- Storage: 누적 ~30TB (12개월)
- 동시 연결 평균 ~2K, 피크 5K
- LLM 호출: 100K/일 → 3M/월

| 옵션 | DB | Storage (30TB) | Egress (월 10TB) | 합계 (월) |
|---|---|---|---|---|
| **AWS RDS db.r6g.xlarge Multi-AZ + R2** | ~$450 (Multi-AZ + 백업) | R2 $450 | **$0** | **~$900** |
| AWS RDS db.r6g.xlarge + S3 Standard | ~$450 | $750 | $1,260 | **~$2,460** |
| Supabase Team $599 + R2 | $599 + 추가 DB 용량 ~$200 | R2 $450 | $0 | **~$1,250** |
| GCP Cloud SQL HA + Cloud Storage | ~$500 | $600 | $1,200 | **~$2,300** |
| NCP Standard PostgreSQL + Object Storage | ~₩600K ($450) | ₩900K ($670) | ₩1M ($740) | **~$1,860 (~₩2.5M)** |

**권장**: AWS RDS + Cloudflare R2 조합이 비용·운영성·확장성 가장 균형. NCP는 국내 데이터 거주성 요구 시.

### 3.4 Scale (DAU 100K, 가족 100K)
- DB: ~2.5TB, 샤딩/리드 리플리카 본격화
- Storage: 누적 200TB
- 동시 연결 피크 ~30K

이 단계에서는 단순 가격 비교보다 **샤딩 전략·리드 리플리카·Citus/AlloyDB 등 확장 기술 선택**이 우선. 본 문서 범위 외.

대략 월 $5,000~$15,000 (Storage·Egress 포함).

---

## 4. 한국 규제 / 앱인토스 통합 고려

### 4.1 개인정보보호법 영향
- **국외 이전 동의**: AWS Seoul·GCP Seoul·NCP·Supabase Tokyo·Cloudflare 전 세계 엣지. **Seoul 리전 = 국내 처리**, 그 외는 국외 이전 동의 필요
- **민감정보**(BabyMedicalNote 알러지·기저질환): 별도 동의 + 분리 보관·암호화 — 본 모델은 E2E 암호화로 대응
- **아동 정보**(만 14세 미만): 보호자 동의 필수. 우리 서비스 대상이 영아라 부모 = 사용자 = 동의자
- **KISA ISMS-P** 인증: 5만 명 이상 또는 정보통신서비스 매출 100억 이상 시 의무. 한국 리전 + 명확한 처리 위탁 계약 필요

### 4.2 앱인토스 채널 특수 사항
- 토스 미니앱 사용자는 100% 한국 → **Seoul 리전 latency 우위 결정적**
- 토스 OAuth 계정 정보는 토스에서 받아 자체 저장 — 처리 위탁 계약 필요
- 토스 IAP 결제 데이터는 한국 내 처리 강력 권장 → NCP/AWS Seoul 우선

### 4.3 백엔드 리전 선택 가이드
| 사업 단계 | 리전 권장 |
|---|---|
| MVP·Early (DAU<5K) | Supabase Tokyo 허용 (latency ~50ms, 국외 이전 동의 표준 약관으로 처리) |
| Growth (DAU 5K~50K) | **AWS Seoul** 또는 GCP Seoul 권장 |
| Scale + 토스 채널 비중↑ | **NCP 또는 AWS Seoul 우선** + KISA ISMS-P 준비 |

---

## 5. 운영 부담 비교

| 후보 | 초기 셋업 시간 | 운영 부담 | DX (개발자 경험) |
|---|---|---|---|
| Supabase | **1일** (Auth+RLS+Realtime 통합) | 낮음 | ⭐⭐⭐⭐⭐ |
| Firebase | 1일 | 낮음 (단 본 모델 재설계 필요) | ⭐⭐⭐⭐ |
| AWS RDS+S3+Cognito+Lambda+SNS | **2주+** (개별 구성) | 중~높음 | ⭐⭐⭐ |
| GCP Cloud SQL+Firebase Auth+FCM | 1주 | 중 | ⭐⭐⭐⭐ |
| NCP | 1주 (한국어 문서·고객지원) | 중 | ⭐⭐⭐ |
| Cloudflare D1+R2+Workers | 3일 (단 D1 한계 검토) | 낮음 | ⭐⭐⭐⭐ |

---

## 6. 최종 권장 스택 (단계별)

### 6.1 MVP (출시 ~ DAU 1K)
```
DB:        Supabase Pro (Postgres + Auth + Realtime + Edge Functions)  $25/월
Storage:   Cloudflare R2 (사진·영상)                                    $5~15/월
Push:      FCM (Android·iOS) + 토스 푸시 정책 확정 시 추가              무료
Functions: Supabase Edge Functions                                       포함
도메인·SSL: Cloudflare (DNS 무료, SSL 무료)                              무료
                                                              총 ~$30~50/월
```
**선택 사유**: 합의 데이터 모델이 Postgres + RLS 기반이라 Supabase가 1:1 매핑. R2 egress 무료로 사진 트래픽 비용 차단. 운영 부담 최소.

### 6.2 Early (DAU 1K~10K)
MVP 스택 유지. DB 용량·동시 연결 한도 도달 시 Supabase Team으로 업그레이드 검토.

### 6.3 Growth (DAU 10K~100K)
```
DB:        AWS RDS PostgreSQL Multi-AZ (Seoul) db.r6g.xlarge          ~$450/월
Storage:   Cloudflare R2                                                ~$450/월
Realtime:  AWS AppSync (GraphQL Realtime) or Soketi(self-host)         ~$50~100/월
Auth:      Cognito User Pools (또는 Supabase Auth 유지)                ~$50/월
Functions: Lambda                                                       ~$50/월
Push:      SNS Mobile Push                                              ~$30/월
                                                              총 ~$1,100/월
```
**선택 사유**: Supabase의 단일 DB 한계 회피 + 리드 리플리카·백업 정책 직접 제어. R2는 그대로 유지(egress 무료의 가치 극대).

### 6.4 한국 규제 우선 트랙
```
DB:        NCP Cloud DB for PostgreSQL (Standard)                     ~₩600K/월
Storage:   NCP Object Storage                                          ~₩900K/월
Realtime:  NCP API Gateway + Cloud Functions                          ~₩100K/월
Push:      NCP Simple Notification Service / FCM                       무료~₩50K
Auth:      자체 + 토스 OAuth + NCP NAS 인증 SDK 검토
                                                              총 ~₩1.7M/월 ($1,300)
```
**선택 사유**: KISA ISMS-P 인증·세금계산서·한국어 SLA. Growth 단계에서 토스 채널 비중이 50% 이상이면 우선.

---

## 7. 의사결정 체크리스트

다음 항목을 다음 회의에서 결정하면 클라우드 단일 후보 확정 가능:

- [ ] **목표 출시 일정**: 빠를수록 Supabase, 여유 있으면 AWS
- [ ] **6개월 내 KISA ISMS-P 신청 여부**: Yes면 NCP 또는 AWS Seoul
- [ ] **앱인토스 채널 비중 예상**: 50%+면 한국 리전 필수
- [ ] **사진 영상 비중**: 동영상 본격 지원 시 R2 egress 무료가 더 결정적
- [ ] **데이터 모델 LLM 호출 비용 한도** (운영사 키 부담): 별도 LLM 예산 1만~10만 사용자 가정 시 월 $200~$2,000
- [ ] **개발팀 PostgreSQL 운영 경험**: 약하면 Supabase 유지가 합리
- [ ] **결제 수단·세금계산서 요구**: 회사 정책이 한국 사업자 우선이면 NCP

---

## 8. 권장 결론

| 단계 | 1순위 | 2순위 | 비고 |
|---|---|---|---|
| **MVP·Early** | **Supabase Pro + Cloudflare R2** | NCP Compact (규제 우선 시) | 합의 데이터 모델이 Postgres 가정 |
| **Growth** | **AWS RDS Seoul + Cloudflare R2** | Supabase Team + R2 (운영 단순성 유지) | Multi-AZ·리드 리플리카 필요 시점 |
| **한국 규제 우선** | **NCP Cloud DB + NCP Object Storage** | AWS Seoul + 명확한 국외이전 동의 | KISA ISMS-P 인증 시 |
| **LLM 인프라** | 클라우드와 무관, Gemini/OpenAI/Anthropic 직접 호출 | — | `LLMUsageQuota`로 본 모델에서 추적 |

**핵심 비용 절감 원칙**:
1. **사진 객체 스토리지는 R2** (egress 무료) — 갤러리 앱의 결정적 차이
2. **DB는 Postgres 호환** 유지 — Firestore 전환은 재설계 비용 막대
3. **MVP는 단일 벤더 통합형** (Supabase) — 운영 부담을 비용보다 우선
4. **Growth부터는 개별 컴포넌트 분리** — 각 단가 최적 후보 선택

---

## 10. 개발 속도 vs 변환 용이성 매트릭스 (2026-05-20 추가)

> "변환 용이성" = **다른 백엔드로 마이그레이션 비용**(vendor lock-in의 역)

| 클라우드 | 개발 속도 | 변환 용이성 | 종합 | 핵심 사유 |
|---|---|---|---|---|
| **Supabase** | ★★★★★ | ★★★★★ | **🏆 최적** | 표준 Postgres + RLS · Auth/Realtime/Storage 통합 · 데이터 모델 그대로 타 Postgres 이전 가능 |
| **Firebase** | ★★★★★ | ★ | 개발 1위, 변환 최악 | NoSQL 문서 + Security Rules + 폐쇄 SDK · 다른 백엔드 이동 시 재설계 필수 |
| **Neon** | ★★★★ | ★★★★★ | 변환 1위 | 순수 Postgres + branching · Auth/Storage 별도 조합 필요 |
| **AWS RDS + S3 + Cognito + Lambda** | ★★ | ★★★★ | 변환 좋지만 셋업 부담 | 표준 Postgres·S3 · 셋업 2주+, IAM 복잡 |
| **GCP Cloud SQL + Storage + Firebase Auth + FCM** | ★★★ | ★★★★ | 중간 | Cloud SQL 표준 + Firebase 일부 결합 |
| **Cloudflare D1 + R2 + Workers** | ★★★ | ★★★ | 부분 표준 | R2는 S3 API 호환 / D1은 SQLite, PostgreSQL 호환 X |
| **Naver Cloud (NCP)** | ★★ | ★★★★ | 한국 + 표준 | 표준 Postgres·MySQL, 콘솔 단순 |
| **NHN Cloud** | ★★ | ★★★★ | 한국 + 표준 | 표준 Postgres·MySQL, 문서 산만 |
| **Kakao Cloud** | ★★ | ★★★★ | 신규 라인업 한정 | 표준 Postgres · 일부 서비스 미출시 |
| **KT Cloud** | ★★ | ★★★ | 엔터프라이즈 위주 | 콘솔/API 복잡, 가격 부담 |

### 평가 차원 정의
- **개발 속도**: 셋업 시간 + 통합 SDK 완성도(Auth/Storage/Realtime/Functions/Push 한 벤더 제공 여부) + 문서·에코시스템
- **변환 용이성**: 표준 SQL/API 준수 + 데이터 export 도구 + 코드 변경 비용 + 의존성 깊이

### 시나리오별 1순위
| 시나리오 | 1순위 |
|---|---|
| 개발 속도만 최우선 | Firebase |
| **개발 속도 + 변환 용이성 균형** | **Supabase** |
| 변환 용이성만 최우선 | Neon (Auth/Storage 별도 조합) |
| 한국 규제 우선 | NHN Cloud / NCP (표준 Postgres라 변환도 양호) |

### Firebase 결정의 재검토 트리거
다음 중 하나 이상 발생 시 데이터 모델을 Postgres-호환으로 되돌릴 가치:
- Growth 단계(DAU 5K+) 진입 — Firebase Realtime listener 비용 폭증
- KISA ISMS-P 인증 또는 데이터 거주성 의무 발생
- 향후 자체 분석 파이프라인(BigQuery 직결 외)·복잡한 SQL 분석 요구
- 팀 내 PostgreSQL 경험자 증가, NoSQL 운영 부담 인지

이때 **Supabase로 전환하면 이전 Postgres 합의안 [_drafts/data-model-postgres-v1.md](./_drafts/data-model-postgres-v1.md)가 거의 그대로 사용 가능**.

---

## 11. 다음 작업 후보

- 본 문서 검토 후 1순위 1개 선택 → `infrastructure/` 디렉토리에 Terraform/Pulumi 초안 작성
- LLM 호출 비용 별도 시뮬레이션 (Gemini Flash 2.5 / Pro / GPT-4o / Claude 가격 × 사용량)
- 백업·재해복구·SLA 비교 (월 비용에 포함되는 항목 명시)
- **§10 매트릭스 기반 Firebase ↔ Supabase 재검토** (필요 시)
