# UC-1 분류기 학습 핸드북 (Datasets & Training)

> 실무 매뉴얼. 무엇을·왜 하는지는 [training-plan.md](./training-plan.md), 처리 흐름은 [pipeline.md](./pipeline.md), 사용자 시나리오는 [README.md](./README.md).
> 최종 갱신: 2026-05-22

[training-plan.md](./training-plan.md)가 **전략(무엇/왜)**이라면, 이 문서는 **실행(어떻게)** 이다. 새로 합류한 엔지니어가 이 한 페이지로 데이터를 받고 v0.1 모델을 학습·변환할 수 있도록 한다.

---

## 1. 데이터셋 카탈로그

### 1.1 사용 데이터셋 (학습용)

#### **Donate-a-Cry Corpus** — 1차 부트스트랩
| 항목 | 값 |
|---|---|
| 출처 | https://github.com/gveres/donateacry-corpus |
| 크기 | 457 클립, 평균 7.72초 |
| 클래스 | 5종: `hungry`, `belly_pain`, `burping`, `discomfort`, `tired` |
| 라이선스 | ODbL 1.0 + DBCL 1.0 (Open Database License) |
| 라벨링 | 기여 부모 자기 라벨 (신뢰성 검증 안 됨) |
| 다운로드 | `git clone https://github.com/gveres/donateacry-corpus.git` |
| **우리 4-mega 매핑** | `hungry`→`cry_hunger`, `tired`→`cry_sleepy`, `belly_pain`→`cry_pain`, `burping`+`discomfort`→`cry_discomfort` |

> ⚠️ ODbL의 share-alike 조항이 학습된 모델 아티팩트에 미치는 영향에 대한 법무 검토 필요. 1차 실험 단계는 진행하되, 상용 배포 전 검토.

#### **AudioSet (non-cry 부분)** — `not_cry` 클래스 보조
| 항목 | 값 |
|---|---|
| 출처 | https://research.google.com/audioset/ |
| 크기 | 200만+ 클립 중 우리 용도 ~3,000~10,000 선별 |
| 라이선스 | CC-BY 4.0 (메타데이터), 오디오는 YouTube 링크 |
| 우리 활용 | "Baby cry"가 아닌 가정 환경음 (TV, 식기, 청소기, 영아 비-울음 발화) |
| 다운로드 | `audioset_download` Python 패키지 또는 직접 yt-dlp |
| **선별 카테고리** | `Speech`, `Television`, `Cutlery, silverware`, `Vacuum cleaner`, `Babbling`, `Laughter (infant)` 등 |

#### **ICSD: Infant Cry and Snoring Detection** — 검증 보조
| 항목 | 값 |
|---|---|
| 출처 | https://arxiv.org/html/2408.10561v1 |
| 라이선스 | 공개 (논문 참조) |
| 우리 활용 | 울음/비-울음 이진 검증 셋, `not_cry` 보강 |

### 1.2 평가용 데이터셋

#### **자체 수집 한국 영아 데이터** — 최종 평가 (M3+)
| 항목 | 값 |
|---|---|
| 출처 | 자체 수집 ([training-plan.md §4.2](./training-plan.md)) |
| 크기 목표 | M3 50건 → M4 500건 → M5 3,000건+ |
| 라벨 | 사용자 in-app 환류 (`consent_for_training=true` 한정) |
| 보관 | Kakao Cloud Object Storage 별도 버킷, 가명화 |
| **중요**: 외부 공개 데이터셋과 물리적으로 분리된 학습 환경에서만 사용 (개인정보보호 사유) |

### 1.3 참고만 (학습 미사용)

| 데이터셋 | 사용 안 하는 이유 |
|---|---|
| **Ubenwa CryCeleb** | CC-BY-NC-ND — **비상업 금지**, 상용 앱 학습 불가 |
| **Baby Chillanto** | 병리 진단 데이터 (질식·난청 포함) — 우리 용도와 다름, 윤리 검토 별도 필요 |
| **DeepInfant 비공개 데이터** | 외부 모델 학습 데이터, 접근 불가 |

---

## 2. 디렉토리 구조

ML 작업 폴더는 앱 git 저장소와 별도. `.gitignore`로 데이터·모델 제외.

```
nyamnyamkoolkool-ml/
├── data/
│   ├── raw/
│   │   ├── donateacry-corpus/    # git clone 그대로
│   │   ├── audioset/             # 다운로드된 yt-dlp wav
│   │   └── icsd/
│   ├── preprocessed/             # 16kHz mono wav, 4-mega 라벨 폴더
│   │   ├── cry_hunger/
│   │   ├── cry_discomfort/
│   │   ├── cry_pain/
│   │   ├── cry_sleepy/
│   │   └── not_cry/
│   └── embeddings/               # YAMNet 임베딩 (.npz)
├── models/
│   ├── v0.1/
│   │   ├── classifier.h5
│   │   ├── classifier.tflite
│   │   ├── classifier.mlmodel
│   │   └── metrics.json
│   └── v0.2/
├── notebooks/
│   ├── 01_data_exploration.ipynb
│   ├── 02_embedding_extraction.ipynb
│   ├── 03_classifier_training.ipynb
│   └── 04_evaluation.ipynb
├── src/
│   ├── preprocess.py             # raw → preprocessed
│   ├── extract_embeddings.py     # preprocessed → embeddings
│   ├── train.py                  # FC 헤드 학습
│   ├── evaluate.py               # confusion matrix, F1
│   └── convert.py                # TFLite/CoreML 변환
├── requirements.txt
├── .gitignore                    # data/, models/ 제외
└── README.md
```

---

## 3. 데이터 전처리

### 3.1 표준화 사양

| 항목 | 값 | 이유 |
|---|---|---|
| 샘플링 레이트 | **16 kHz** | YAMNet 표준 입력 |
| 채널 | mono | 멀티채널 처리 단순화 |
| 비트 | 16-bit PCM | 표준 |
| 길이 | 5~30초 (5초 단위로 분할) | YAMNet 윈도우 정수배 |
| 무음 제거 | -40dB 이하 silence trim | librosa.effects.trim |
| 정규화 | peak normalize -1dB | AGC 효과 |

### 3.2 전처리 스크립트 예시 (`src/preprocess.py`)

```python
"""raw 데이터 → 16kHz mono wav로 표준화, 4-mega 라벨 폴더로 분류."""
import librosa
import soundfile as sf
from pathlib import Path

# Donate-a-Cry 5분류 → 우리 4-mega 매핑
LABEL_MAP = {
    "hungry": "cry_hunger",
    "tired": "cry_sleepy",
    "belly_pain": "cry_pain",
    "burping": "cry_discomfort",
    "discomfort": "cry_discomfort",
    # AudioSet 비-울음 → not_cry
    "speech": "not_cry",
    "television": "not_cry",
    "cutlery": "not_cry",
    # 등
}

def standardize(input_path: Path, output_path: Path):
    y, sr = librosa.load(str(input_path), sr=16000, mono=True)
    y, _ = librosa.effects.trim(y, top_db=40)        # 무음 제거
    peak = max(abs(y.max()), abs(y.min()))
    y = y / peak * 0.891                              # -1dB peak normalize
    sf.write(str(output_path), y, 16000, subtype="PCM_16")

def process_donateacry(src_root: Path, dst_root: Path):
    """Donate-a-Cry 파일명에서 라벨 추출.
    파일명 형식: {gender}-{age}-{label}-{id}.wav 식 (실제는 약간 다름, 코퍼스 README 참조)
    """
    for wav in src_root.rglob("*.wav"):
        # 라벨 파싱 로직 (코퍼스 메타데이터 참조)
        ...
        mapped = LABEL_MAP.get(raw_label)
        if not mapped:
            continue
        out_dir = dst_root / mapped
        out_dir.mkdir(parents=True, exist_ok=True)
        standardize(wav, out_dir / wav.name)
```

### 3.3 데이터 증강 (학습 시 적용)

```python
# librosa·audiomentations 활용
import audiomentations as A

augment = A.Compose([
    A.PitchShift(min_semitones=-2, max_semitones=2, p=0.5),
    A.TimeStretch(min_rate=0.9, max_rate=1.1, p=0.5),
    A.AddGaussianNoise(min_amplitude=0.001, max_amplitude=0.015, p=0.5),
    A.AddBackgroundNoise(  # 한국 가정 환경 잡음 음원 폴더 필요
        sounds_path="data/raw/home_noise_ko/",
        min_snr_in_db=5,
        max_snr_in_db=20,
        p=0.5
    ),
])
```

**한국 가정 잡음 자체 수집**: 에어컨·식기·한국어 TV·청소기 등 30초 클립 100개 정도. 별도 동의 절차 없이 자체 녹음 가능 (사람 발화 포함 시 동의 필요).

---

## 4. 학습 절차

### 4.1 v0.1: YAMNet + FC 헤드 (MVP)

**개념**: YAMNet (frozen) → 1024-d 임베딩 → FC 5-class softmax

#### Step 1. YAMNet 임베딩 추출 (`src/extract_embeddings.py`)

```python
import tensorflow as tf
import tensorflow_hub as hub
import numpy as np
import librosa
from pathlib import Path

# YAMNet 로드 (TF Hub)
yamnet = hub.load("https://tfhub.dev/google/yamnet/1")

CLASSES = ["cry_hunger", "cry_discomfort", "cry_pain", "cry_sleepy", "not_cry"]

def extract(wav_path: Path):
    """YAMNet은 16kHz mono float32 [-1, 1]을 받음. 출력은 (N, 1024) 임베딩."""
    waveform, _ = librosa.load(str(wav_path), sr=16000, mono=True)
    waveform = waveform.astype(np.float32)
    _, embeddings, _ = yamnet(waveform)  # embeddings: (N_frames, 1024)
    return embeddings.numpy().mean(axis=0)  # 평균 풀링 → (1024,)

# 전체 데이터 처리
X, y = [], []
for ci, cls in enumerate(CLASSES):
    for wav in (Path("data/preprocessed") / cls).glob("*.wav"):
        emb = extract(wav)
        X.append(emb)
        y.append(ci)

X = np.array(X)
y = np.array(y)
np.savez("data/embeddings/yamnet_v0.1.npz", X=X, y=y, classes=CLASSES)
print(f"Extracted {len(X)} embeddings, shape {X.shape}")
```

#### Step 2. FC 헤드 학습 (`src/train.py`)

```python
import tensorflow as tf
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight

data = np.load("data/embeddings/yamnet_v0.1.npz", allow_pickle=True)
X, y = data["X"], data["y"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.15, stratify=y, random_state=42
)
X_train, X_val, y_train, y_val = train_test_split(
    X_train, y_train, test_size=0.176, stratify=y_train, random_state=42
)  # 최종 70/15/15

# 클래스 불균형 보정
weights = compute_class_weight("balanced", classes=np.unique(y_train), y=y_train)
class_weight = dict(enumerate(weights))

model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(1024,)),
    tf.keras.layers.Dense(128, activation="relu"),
    tf.keras.layers.Dropout(0.3),
    tf.keras.layers.Dense(5, activation="softmax"),
])
model.compile(
    optimizer=tf.keras.optimizers.Adam(1e-3),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

callbacks = [
    tf.keras.callbacks.EarlyStopping(patience=10, restore_best_weights=True),
    tf.keras.callbacks.ReduceLROnPlateau(patience=5, factor=0.5),
]

history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=100,
    batch_size=32,
    class_weight=class_weight,
    callbacks=callbacks,
)

model.save("models/v0.1/classifier.h5")
```

#### Step 3. 평가 (`src/evaluate.py`)

```python
import tensorflow as tf
import numpy as np
import json
from sklearn.metrics import classification_report, confusion_matrix, f1_score

model = tf.keras.models.load_model("models/v0.1/classifier.h5")
data = np.load("data/embeddings/yamnet_v0.1.npz", allow_pickle=True)
# X_test, y_test를 train.py와 같은 split으로 재현 (random_state 동일)

y_pred = model.predict(X_test).argmax(axis=1)
report = classification_report(
    y_test, y_pred, target_names=CLASSES, output_dict=True
)
cm = confusion_matrix(y_test, y_pred).tolist()

metrics = {
    "macro_f1": f1_score(y_test, y_pred, average="macro"),
    "accuracy": (y_pred == y_test).mean(),
    "per_class": report,
    "confusion_matrix": cm,
    "model_version": "v0.1.0",
}
with open("models/v0.1/metrics.json", "w") as f:
    json.dump(metrics, f, indent=2)

print(f"Macro F1: {metrics['macro_f1']:.3f}")
print(f"Accuracy: {metrics['accuracy']:.3f}")
```

**목표 게이트**: Test macro-F1 ≥ 0.55, Top1 accuracy ≥ 0.60 ([training-plan.md M2](./training-plan.md)).

### 4.2 v0.5: CNN-LSTM (선택, 데이터 누적 후)

[training-plan.md §5 v0.5+](./training-plan.md) 참조. 자체 환류 데이터 ≥ 3,000건 누적 후 진행.

핵심 아키텍처:
```
mel-spectrogram (64 mel × T frames)
  → Conv2D × 3 (residual blocks)
  → BiLSTM × 2
  → Dense 5-class softmax
```

---

## 5. 모바일 변환

### 5.1 TFLite (Android)

```python
# src/convert.py
import tensorflow as tf

model = tf.keras.models.load_model("models/v0.1/classifier.h5")

converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]    # int8 양자화

# 대표 데이터셋 (양자화 정확도 보존)
def repr_dataset():
    for i in range(100):
        yield [X_val[i:i+1].astype(np.float32)]
converter.representative_dataset = repr_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8

tflite_model = converter.convert()
with open("models/v0.1/classifier.tflite", "wb") as f:
    f.write(tflite_model)
```

**중요**: 이 TFLite는 **FC 헤드만 양자화**된 것. YAMNet 자체는 별도 (TF Hub에 TFLite 버전 존재). 모바일 통합 시 두 모델을 파이프라인으로 호출 — 자세한 통합은 [pipeline.md §3](./pipeline.md).

### 5.2 CoreML (iOS)

```python
import coremltools as ct

model = tf.keras.models.load_model("models/v0.1/classifier.h5")

mlmodel = ct.convert(
    model,
    inputs=[ct.TensorType(shape=(1, 1024), name="yamnet_embedding")],
    classifier_config=ct.ClassifierConfig(CLASSES),
    minimum_deployment_target=ct.target.iOS15,
)
mlmodel.save("models/v0.1/classifier.mlmodel")
```

---

## 6. 추론 속도 측정 (모바일 시뮬레이션)

학습 후 반드시 측정 — [pipeline.md](./pipeline.md) NFR 충족 여부 확인.

```python
import time
import tflite_runtime.interpreter as tflite

interpreter = tflite.Interpreter(model_path="models/v0.1/classifier.tflite")
interpreter.allocate_tensors()

# 100회 반복 측정
times = []
for _ in range(100):
    start = time.perf_counter()
    interpreter.set_tensor(input_idx, dummy_input)
    interpreter.invoke()
    _ = interpreter.get_tensor(output_idx)
    times.append((time.perf_counter() - start) * 1000)

print(f"평균 추론: {np.mean(times):.2f}ms, p95: {np.percentile(times, 95):.2f}ms")
```

**목표**: FC 헤드 < 5ms. YAMNet까지 포함 < 500ms (실기기 측정 필수).

---

## 7. 운영 체크리스트

학습 → 배포까지 매 사이클 점검:

- [ ] 데이터셋 라이선스 attribution이 모델 메타데이터에 기록되었는가
- [ ] Test 셋이 학습 데이터와 완전 분리되었는가
- [ ] 자체 한국 영아 데이터가 외부 공개 데이터와 물리적으로 분리되어 보관·학습되었는가
- [ ] Macro-F1 ≥ 0.55 (v0.1) / 0.65 (v0.5) 게이트 통과했는가
- [ ] Confusion matrix에서 `cry_pain` ↔ `cry_discomfort` 혼동률 < 20%인가
- [ ] TFLite 양자화 후 정확도 손실 < 2%인가
- [ ] 모바일 실기기 추론 < 500ms (Tier 1 전체)인가
- [ ] 모델 카드(Model Card) 작성 — 클래스, 학습 데이터 출처, 한계 명시
- [ ] OTA 배포 시 모델 버전·해시 기록

---

## 8. 자주 묻는 문제 (FAQ)

### Q1. `not_cry` 클래스가 너무 커서 학습이 편향됨
A. **언더샘플링 + class_weight 병행**. AudioSet에서 너무 많이 뽑지 말고 다른 클래스 × 1.5배 수준으로. `class_weight` 균형 가중치도 함께.

### Q2. Donate-a-Cry 라벨이 의심스러움 (`burping` 일부가 명백히 다른 클래스)
A. **수동 검수 단계 추가**. 첫 500건은 청취 검수, 라벨 불확실 클립은 별도 폴더(`uncertain/`)로 보관. v0.2 학습에서 재검토.

### Q3. AudioSet 다운로드가 느리고 일부 YouTube 비디오 비공개됨
A. **샘플링 + 캐시 전략**. 전체 다운로드 시도하지 말고 카테고리별 500~1000개 목표, 실패는 건너뛰고 yt-dlp 재시도 3회 limit. 한 번 받은 건 절대 다시 안 받게 캐시.

### Q4. 추론 결과가 항상 같은 클래스로 쏠림
A. **데이터 불균형 + softmax 온도** 점검. (1) 클래스별 샘플 수 출력해서 1:10 이상 차이 나는지, (2) 검증 셋 라벨 분포가 학습 셋과 다른지, (3) 평균 풀링이 너무 강한지 (max 풀링·attention 풀링으로 교체 시도).

---

## 9. 다음 단계 매핑

| 학습 마일스톤 | 본 문서 절차 | 검증 게이트 |
|---|---|---|
| **M1 (4주차)**: 데이터 정리 | §1·§3 | 클립 ≥ 5,000, 라벨 매핑 완료 |
| **M2 (8주차)**: v0.1 학습 | §4.1 | Test top1 ≥ 60% |
| **M3 (10주차)**: 통합 PoC | §5·§6 | 한국 영아 자체 50건 ≥ 55% |
| **M4 (16주차)**: 클로즈드 베타 | (앱 통합 별도) | 환류 ≥ 500건 |
| **M5 (24주차)**: v0.2 fine-tune | §4.1 재학습 (환류 데이터 통합) | Top1 ≥ 65% (실사용) |
| **M6 (24주+)**: 출시 | OTA 배포 | 사용자 적중률 ≥ 60% 안정 |

마일스톤 세부는 [training-plan.md §8](./training-plan.md).
