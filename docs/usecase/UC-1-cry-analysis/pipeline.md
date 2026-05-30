# UC-1 처리 시나리오 (Pipeline)

> 사용자 시나리오는 [README.md](./README.md), 자체 분류기 학습 계획은 [training-plan.md](./training-plan.md) 참조.
> 최종 갱신: 2026-05-22

본 문서는 **시스템 내부 처리 시나리오**를 다룬다. "보호자가 무엇을 보고 누른다"가 아니라 "오디오가 입력되었을 때 시스템이 어떤 순서로 무엇을 호출하는가"를 정의한다.

---

## 1. 설계 결정 요약 (2026-05-22)

- **단일 멀티모달 LLM 호출 폐기.** 오디오를 직접 LLM에 던지는 방식은 (a) 학술적으로 원인 분류 신뢰성 미확보, (b) Google·Anthropic·OpenAI 모두 비음성 분류에 한계 명시, (c) attribution 불가·검증 불가의 3중 문제로 채택하지 않는다.
- **2-tier 파이프라인 채택**: `자체 학습 음향 분류기 (온디바이스)` → `텍스트 LLM (종합 추론)`.
- **오디오는 LLM에 전송하지 않는다.** LLM 입력은 분류기 라벨 + 일지 컨텍스트 + 프로필의 **텍스트 토큰만**.

근거: [memory: feedback_input_ux_validation](../../../../.claude/projects/.../memory/), 본 폴더 결정 노트.

---

## 2. 2-tier 아키텍처

```
[오디오 입력 (10초)]
        │
        ▼
┌──────────────────────────────────────────────────┐
│ Tier 1: 자체 학습 음향 분류기 (온디바이스)        │
│  - 입력: PCM 16kHz mono, 5~30초                    │
│  - 출력: { label_probs: {hunger: 0.42, ...},      │
│           is_cry: bool, snr_db: float,            │
│           model_version: "v0.1.0" }               │
│  - 런타임: Core ML (iOS) / TFLite (Android)       │
│  - 지연: < 500ms, 추가 비용 0                     │
│  - 오프라인 동작 OK                               │
│  - 학습·평가 → training-plan.md                    │
└──────────────────────────────────────────────────┘
        │
        ▼ (텍스트 페이로드만 생성)
┌──────────────────────────────────────────────────┐
│ Payload Builder (클라이언트)                      │
│  - 분류기 출력 + 직전 24h 일지 요약 + 프로필      │
│  - JSON 직렬화, PII 마스킹 (실명 → 가명 토큰)     │
│  - 최대 ~800 토큰                                 │
└──────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────┐
│ Tier 2: 텍스트 LLM (활성 프로바이더)              │
│  - Gemini 2.5 Flash (기본) / Claude / GPT / Gemma │
│  - 입력: 텍스트만 → 모든 프로바이더 동등 가능      │
│  - 출력: { ranked_causes, evidence, action }      │
│  - 지연: 2~5초, 비용 ~$0.0001/호출                │
└──────────────────────────────────────────────────┘
        │
        ▼
[결과 카드 + 일지 기록 연결]
```

---

## 3. 단계별 처리 명세

### Tier 1: 음향 분류기 (온디바이스)

| 항목 | 사양 |
|---|---|
| 입력 포맷 | PCM, 16 kHz, mono, 16-bit |
| 입력 길이 | 5~30초 (1초 단위 윈도우 슬라이딩) |
| 전처리 | Mel-spectrogram (n_mels=64, hop=10ms), AGC 후처리 |
| 클래스 (v0.1, 4-mega) | `cry_hunger`, `cry_discomfort`, `cry_pain`, `cry_sleepy`, `not_cry` (게이트키퍼 클래스 통합) |
| 출력 스키마 | `{label_probs: dict, top1: str, top1_conf: float, is_cry: bool, snr_db: float, model_version: str, inference_ms: int}` |
| 신뢰도 게이트 | top1_conf < 0.40 → `top1 = "ambiguous"`, LLM에 그대로 전달 |
| not_cry 처리 | `is_cry=false` → LLM 호출 스킵, UC-1.1 A1(소음 안내)로 분기 |

**클래스 수 결정**: 9분류(DeepInfant 식)는 confidence 분산이 커서 사용자 신뢰 손상. 학술 컨센서스(2024 Nature)도 세분 분류 신뢰 불가. **4 메가카테고리 + not_cry**가 MVP 권장. 세분화는 데이터 누적 후 [training-plan.md](./training-plan.md)에서 단계적.

### Payload Builder (클라이언트 측, 텍스트 직렬화)

LLM에 전송되는 payload 예시 (v0.1):

```json
{
  "baby": {"age_months": 4, "sex": "F", "notes": "특이사항 없음"},
  "acoustic": {
    "top1": "cry_hunger",
    "top1_conf": 0.62,
    "label_probs": {"hunger": 0.62, "discomfort": 0.21, "pain": 0.10, "sleepy": 0.07},
    "snr_db": 18.3,
    "model_version": "v0.1.0"
  },
  "log_recent_24h": {
    "last_feeding": {"at": "T-2h35m", "amount_ml": 120, "type": "formula"},
    "last_sleep": {"woke_at": "T-1h10m", "duration_min": 95},
    "last_diaper": {"at": "T-3h50m", "type": "wet"}
  },
  "env": {"local_time": "18:14", "weather": null}
}
```

**원칙**:
- 모든 시각은 **상대 표현**(`T-2h35m`) — LLM이 절대 시각 추론 실수 방지
- 아기 실명은 페이로드에 절대 포함하지 않음 (UC-4.1에서 가명 토큰 매핑)
- 8개 분야 모두 비어도 호출 가능 (cold start 가정)

### Tier 2: 텍스트 LLM 호출

| 항목 | 사양 |
|---|---|
| 시스템 프롬프트 | 공통 (프로바이더 무관), 출력 스키마 강제 (JSON mode) |
| 활성 프로바이더 | UC-4.4 사용자 선택. **모두 텍스트 호출**이므로 동등 가능 |
| 출력 스키마 | `{ranked_causes: [{cause, confidence_band, evidence}], recommended_action, safety_disclaimer, llm_provider}` |
| confidence_band | "high"/"medium"/"low" — **수치 % 노출 금지** (학술적 근거 부족) |
| 캐싱 | 동일 페이로드 해시 5분 캐시 (반복 호출 비용 절감) |

**프롬프트 설계 원칙 (요약)**:
- "분류기 라벨과 일지 신호 중 어느 쪽이 더 강한지 명시하라"는 지시
- 학술적 면책 자동 삽입 (`safety_disclaimer`)
- 응급 키워드(고열·청색증·경련 의심) 감지 시 의료 권고 우선

---

## 4. 에러·폴백 흐름

| ID | 상황 | 처리 |
|---|---|---|
| **F1** | 분류기 `is_cry=false` | LLM 호출 안 함. "조용한 환경에서 다시 녹음" 안내 |
| **F2** | 분류기 top1_conf < 0.40 | `top1=ambiguous`로 LLM에 전달. LLM은 일지 신호만으로 추론 |
| **F3** | 네트워크 차단·LLM 호출 실패 | **분류기 결과만으로 결과 카드 표시** ("일지 기반 보조 추론은 온라인 복귀 시") |
| **F4** | LLM JSON 파싱 실패 | 1회 재시도, 실패 시 분류기 결과 + 룰베이스 메시지로 폴백 |
| **F5** | SNR_db < 5 (잡음 우세) | "주변이 시끄러워요. 가까이서 다시 녹음해주세요" |
| **F6** | 분류기 모델 미설치 (앱 첫 실행) | 백그라운드 다운로드 안내. 다운로드 전에는 일지-only LLM 호출 |

**중요한 변화**: 기존 시나리오의 E1("Gemma 4 온디바이스 멀티모달 폴백")은 **삭제 가능**. 분류기 자체가 온디바이스 동작하므로 멀티모달 Gemma가 필요 없다. 텍스트 LLM 폴백은 작은 텍스트 모델 또는 룰베이스로 충분.

---

## 5. 채널별 가용성

| 단계 | 네이티브 (iOS/Android) | 앱인토스 (웹뷰) |
|---|---|---|
| Tier 1 분류기 | ✅ Core ML / TFLite 온디바이스 | ⚠️ 옵션 A: 서버 사이드 분류기 / 옵션 B: WebAssembly + ONNX (실험) |
| Tier 2 LLM | ✅ | ✅ |
| 오프라인 동작 | ✅ Tier 1만으로 결과 표시 | ❌ 항상 네트워크 의존 |

**앱인토스 결정**: MVP는 **서버 사이드 분류기**(옵션 A) 채택. WebAssembly 경로는 로드 시간·번들 크기 문제. 분류기 추론 비용은 자체 호스팅이므로 거의 0.

---

## 6. 비기능 요구사항

| 항목 | 목표 |
|---|---|
| 끝-끝 지연 | < 4초 (분류기 0.5s + 네트워크 + LLM 2~3s) |
| Tier 1 단독 응답 | < 1초 (오프라인 모드) |
| 호출 비용 (Tier 2) | < $0.0002/호출 (텍스트 토큰 ~600 in / ~200 out) |
| 정확도 (Tier 1 top1) | 자체 검증 데이터셋 기준 ≥ 70% (4-mega) — 자세한 평가는 [training-plan.md](./training-plan.md) |
| 사용자 적중률 (E2E) | 1순위 사용자 "맞았다" 비율 ≥ 60% (UC-1.0 검증 게이트) |
| 프라이버시 | 오디오는 디바이스를 벗어나지 않음 (Tier 1 온디바이스). 사용자가 명시적 동의한 경우에만 학습용 업로드 |

---

## 7. 데이터 모델 영향

[_specs/data-model.md](../_specs/data-model.md)에 추가 필요한 필드:

```
CryAnalysis {
  ...
  acoustic_classifier: {
    model_version: string,
    label_probs: map<string, float>,
    top1: string,
    top1_confidence: float,
    snr_db: float,
    inference_ms: int
  },
  llm_inference: {
    provider: string,
    model: string,
    ranked_causes: [...],
    cost_usd: float
  },
  user_feedback: {                // UC-1.1 step 6 환류
    confirmed_cause: string?,
    user_rated_correct: bool?,
    consent_for_training: bool
  }
}
```

**핵심**: `user_feedback.consent_for_training=true`인 샘플만 [training-plan.md](./training-plan.md)의 환류 데이터로 사용.

---

## 8. 미해결 사항 (Open Questions)

- **분류기 v0.1 부트스트랩 데이터**: 외부 공개 데이터셋(Donate-a-Cry 등)으로 cold start 후 자체 수집으로 대체. 정확한 데이터 믹스 비율 → training-plan.md.
- **앱인토스 분류기 서버 호스팅 비용**: 현 Firebase + Kakao Cloud 스택에서 추론 워크로드 배치 위치(Cloud Run? Vertex AI?) 미결정.
- **다국어 지원 시 분류기 영향**: 분류기는 언어 비의존이나, 부모 발화·환경음(한국어 TV 등)의 SNR 처리 검증 필요.
- **응급 키워드 감지 책임**: Tier 1 분류기에서 통증/고통 시그널을 별도 클래스로 학습할지, Tier 2 LLM에서만 처리할지.
- **모델 업데이트 OTA 정책**: 분류기 모델 파일 버전 관리, 강제 업데이트 정책 (UC-4.4의 프로바이더 설정과 연계).
