# 냠냠쿨쿨 UseCase 문서

> AI 기반 육아 보조 모바일 앱
> 최종 갱신: 2026-05-18

## 문서 구조

- **[main-scenario.md](./main-scenario.md)** — 전체 메인 시나리오 (제품 개요, 페르소나, 4대 기능 통합 흐름, 비기능 요구사항, **배포 채널 §7**)
- **UC별 상세**: 각 큰 틀 폴더의 `README.md`
- **[_specs/data-model.md](./_specs/data-model.md)** — 데이터 모델 스키마 합의안 (3 에이전트 독립 초안 → 3 비판 라운드 → 합의)
- **[_specs/cloud-cost-comparison.md](./_specs/cloud-cost-comparison.md)** — 클라우드 인프라 비용·운영성 비교 (Firebase/AWS/GCP/NCP/Supabase/Cloudflare)

## 4대 UseCase

| # | UseCase | 폴더 |
|---|---|---|
| 1 | **울음소리 AI 분석** | [UC-1-cry-analysis](./UC-1-cry-analysis/README.md) |
| 2 | **육아일지** (수유/수면/배변/음성비서) | [UC-2-parenting-log](./UC-2-parenting-log/README.md) |
| 3 | **가족 초대 사진 갤러리** | [UC-3-photo-gallery](./UC-3-photo-gallery/README.md) |
| 4 | **아기 정보 및 설정** (프로필/성장/AI 팁/프로바이더) | [UC-4-baby-info-settings](./UC-4-baby-info-settings/README.md) |

## 핵심 설계 원칙

- **액티브 인터랙션 최소화**: 행동 중 버튼을 누르는 인터랙션 지양. 사후 입력 + 음성비서 호출 우선
- **멀티 LLM 프로바이더**: Gemini 2.5 Flash 기본 / Gemini 컨슈머 유료(최신 모델) / OpenAI / Anthropic / **Gemma 4 온디바이스 오프라인 폴백**
- **가족 단위 공유**: 양육 참여 가족 구성원이 같은 정보를 실시간 공유
- **이중 배포 채널**: iOS/Android **네이티브 앱** + **앱인토스(Apps in Toss) 미니앱**. 동일 백엔드·가족 그룹 공유, 채널별 기능 매트릭스는 [main-scenario.md §7](./main-scenario.md#7-배포-채널-distribution-channels) 참조

## 작성 규칙

- 새 시나리오는 4대 UC 중 하나에 섹션으로 추가 (별도 폴더 신설 지양)
- 각 UC 폴더는 향후 와이어프레임/프롬프트/시퀀스 다이어그램 등 부가 산출물 보관 가능
- UC별 변경은 해당 폴더 README에서, 전체 흐름 변경 시에만 main-scenario.md 갱신
