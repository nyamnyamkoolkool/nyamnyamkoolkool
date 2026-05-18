# 냠냠쿨쿨 (NyamNyam KoolKool)

AI 기반 육아 보조 모바일 앱 — 0~24개월 영아 보호자를 위한 통합 양육 도구.

## 핵심 기능

1. **울음소리 AI 분석** — 멀티모달 LLM(오디오 입력)으로 울음 원인을 누적 일지 컨텍스트와 결합하여 추론
2. **육아일지** — 수유 / 수면 / 배변. 사후 입력 + 음성비서(Siri / Google Assistant / Bixby) 우선
3. **가족 초대 사진 갤러리** — 달력형 일자별 정리, 권한별 가족 공유
4. **아기 정보 및 설정** — 프로필, 성장(WHO 곡선), AI 맞춤 팁, LLM 프로바이더 관리

## LLM 프로바이더

| 구분 | 모델 | 비고 |
|---|---|---|
| 기본 (운영사 키) | Gemini 2.5 Flash (Google AI Studio) | 신규 사용자 즉시 사용 |
| Gemini 유료 연동 | 최신 Gemini 모델 | Google AI Pro/Ultra 등 구독자 OAuth |
| BYOK | OpenAI GPT-4o(audio) | 사용자 API 키 |
| BYOK | Anthropic Claude | 사용자 API 키 |
| 오프라인 폴백 | Gemma 4 (온디바이스) | 네트워크 미연결 시 자동 전환 |

## 문서

- 인덱스: [`docs/usecase/README.md`](./docs/usecase/README.md)
- 메인 시나리오: [`docs/usecase/main-scenario.md`](./docs/usecase/main-scenario.md)
- UC별 상세
  - [UC-1 울음소리 AI 분석](./docs/usecase/UC-1-cry-analysis/README.md)
  - [UC-2 육아일지](./docs/usecase/UC-2-parenting-log/README.md)
  - [UC-3 가족 초대 사진 갤러리](./docs/usecase/UC-3-photo-gallery/README.md)
  - [UC-4 아기 정보 및 설정](./docs/usecase/UC-4-baby-info-settings/README.md)

## 폴더 구조

```
.
├── README.md
├── UseCase.md              # docs/usecase 로의 포인터
├── design/                 # 화면 디자인 초안 (HTML 목업)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── screens/            # 13개 화면별 HTML
└── docs/
    └── usecase/            # UseCase 문서 (4개 큰 틀)
```

## 상태

초기 기획 및 디자인 초안 단계.
