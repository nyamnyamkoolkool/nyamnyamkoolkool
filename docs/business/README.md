# 냠냠쿨쿨 비즈니스 문서

> 사업 운영 비용 · 수익 모델 · 단위 경제(Unit Economics) 정리
> 최종 갱신: 2026-05-20 (가족 8명·광고 모델 반영)

## 문서 구조

| 문서 | 책임 |
|---|---|
| **[backend-cost.md](./backend-cost.md)** | 백엔드 인프라 비용 구조 (Firebase 기준 단계별 breakdown) |
| **[llm-cost.md](./llm-cost.md)** | LLM API 호출 비용 모델 (Gemini · OpenAI · Anthropic · Gemma 4) |
| **[business-model.md](./business-model.md)** | 수익 모델 (광고 + Pro + Family) · 단위 경제 · 손익 시뮬레이션 |
| **[competitor-analysis.md](./competitor-analysis.md)** | 경쟁 육아앱 비교 (FamilyAlbum · Tinybeans · Huckleberry · 베이비빌리) + 우리 모델 보정 권장 |

## 핵심 결론 (한눈에)

### DAU 100 시드 단계 월 운영비
| 항목 | 금액 | 비고 |
|---|---|---|
| Firebase Spark (무료 한도 내) | ~$1 | Cloud Functions 필수라 Day 1 Blaze |
| LLM API (Gemini 2.5 Flash 운영사 키) | ~$13 | 가족 25팀 × 활성 4명 × 6.5호출/일 |
| 도메인·SSL (Cloudflare) | $0~1 | |
| **총 운영비** | **~$15/월** | 가족당 약 $0.6 |

### 무료 한도 (갱신)
- **가족 멤버 수: 8명** (엄마·아빠·양가 조부모 4 + 시터·예비 2)
- 울음 분석 8건/일 / AI 팁 5건/일 / 패턴 인사이트 월 4건
- 사진 합산 10GB / 영상 ❌
- **광고 노출: 일 평균 7회** (홈 배너 + AI 팁 사이 네이티브)

### 수익 모델 3 채널
| 채널 | 가족당 월 수익 (활성 4명) |
|---|---|
| **광고** (무료 사용자만, eCPM $3) | $2.52 (~₩3,300) |
| **Pro 구독 (₩4,900/월)** | $3.45 (Toss) / $2.40 (Apple/Google) |
| **Family Plan (₩9,900/월)** | $6.90 (Toss) / $4.80 |

### 가족당 마진 (월)
| 유형 | 마진 | 비고 |
|---|---|---|
| **Free (광고)** | **+₩2,800** | 광고 덕분에 무료도 흑자 |
| Pro (Toss) | +₩4,300 | |
| Family Plan (Toss) | +₩8,800 | |

### 손익 분기점
- **DAU ~20K** (eCPM $3 / Pro 전환 5% / Toss 결제 40% 가정)
- 이전 (가족 3명·광고 없음) DAU 100K에서 **80% 단축**
- 누적 적자 시드 → 손익분기: **~₩1억** (이전 ₩2~3억에서 단축)

### 핵심 레버
1. **광고 eCPM 단가** (영아 카테고리 $3~8 추정, 손익분기 5~12배 변동)
2. **앱인토스 + 가족 초대 viral** (CAC 50~200×, k-factor 3~5)
3. **Toss IAP 비율** (Apple/Google 30% → Toss 3%, 사용자당 +₩1,320)
4. **LLM 운영사 부담률** (Gemini OAuth/BYOK 유도로 LLM 비용 transfer)

## 광고 정책 (영아 보호자 안전 가이드)

| 허용 카테고리 | 금지 카테고리 |
|---|---|
| 분유·이유식·기저귀·유아용품 | 도박 |
| 영유아 보험·건강검진·예방접종 | 성인 콘텐츠 |
| 유아교육·놀이 콘텐츠 | 체중감량·다이어트 |
| 사진·기념품·산후조리 | 외형·미용 시술 |
| 부모 셀프케어·심리상담 | 정치·종교 |

**광고 노출 제외 화면**: 울음 분석 결과 / 일지 입력 / 응급 의료 안내 / 사진 갤러리 사이

## 참조
- 데이터 모델: [_specs/data-model.md](../usecase/_specs/data-model.md)
- 클라우드 비교: [_specs/cloud-cost-comparison.md](../usecase/_specs/cloud-cost-comparison.md)
- 메인 시나리오: [main-scenario.md](../usecase/main-scenario.md)
