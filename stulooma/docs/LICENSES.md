# 라이선스·에셋 출처

확인일: 2026-10-18 (Asia/Seoul). 아래는 실제 설치 파일과 npm 메타데이터에서 얻은 기록이다. 법률 자문, 모든 권리의 확인 또는 상용 출시 승인을 뜻하지 않는다.

## 자체 코드·에셋

프로젝트 `package.json`은 현재 **`UNLICENSED`**다. STULOOMA 자체 코드·생성 모델·브랜드의 공개 배포 라이선스를 정하지 않았으며 이 문서는 제3자에게 자체 코드의 재배포 권한을 부여하지 않는다.

| 에셋 | 출처 | 상태 |
|---|---|---|
| 반팔·농구 실제 3D 모델 | `src/core/garments/index.ts`, `scripts/generate-assets.ts` | 독립 파라메트릭 제작; 타사 내장 모델 추출 없음 |
| STULOOMA 앱 아이콘 | `public/icon.svg` | 자체 제작 벡터 |
| 투명 PNG·체크 패턴·샘플 SVG | `scripts/generate-assets.ts` | 자체 도형 생성; SVG 편집 가져오기 기능을 의미하지 않음 |
| 한글 예제 프로젝트 | `scripts/generate-project-sample.ts` | 자체 샘플 이미지·한글 텍스트와 원본 레이어 보존 |
| 사용자 파일 | 사용자 선택 PNG/GLB | 앱은 해당 파일의 사용·재배포권을 확인하지 않음 |

## 직접 의존성과 데스크톱 런타임

| 패키지 | 설치 버전 | 선언 라이선스 | 사용 |
|---|---|---|---|
| `@fontsource-variable/noto-sans-kr` | 5.3.1 | OFL-1.1 | 로컬 한글 가변 글꼴 |
| `react`, `react-dom` | 19.3.1 | MIT | UI |
| `three` | 0.186.1 | MIT | 메시·UV·PBR·GLB |
| `@react-three/fiber` | 9.8.2 | MIT | React 렌더 통합 |
| `@react-three/drei` | 10.7.9 | MIT | 카메라·뷰 보조 |
| `zustand` | 5.0.15 | MIT | 편집 상태 |
| `fflate` | 0.8.3 | MIT | ZIP |
| `lucide-react` | 1.59.0 | ISC | 범용 UI 아이콘 |
| `electron` | 44.9.0 | MIT 및 배포본 구성요소별 고지 | Chromium/Node 데스크톱 런타임 |

MIT·ISC·BSD·Apache-2.0은 각 조건을 지키는 상용 사용을 허용하는 라이선스다. 해당 사실만으로 앱 전체의 배포 허가나 특허·상표·모든 에셋 권리가 확인되는 것은 아니다. 저작권/허가문·NOTICE 등 각 고지를 보존해야 한다.

### 한글 글꼴

`node_modules/@fontsource-variable/noto-sans-kr/LICENSE`와 `package.json`에서 **Google Inc., SIL Open Font License 1.1**을 직접 확인했다. 원본 글꼴을 수정하지 않고 npm 패키지의 CSS/WOFF2를 로컬 번들한다. OFL은 고지·라이선스를 동봉하는 소프트웨어 번들과 상용 사용을 허용하지만 글꼴 자체만 별도 판매할 수 없고, 수정본의 Reserved Font Name 등 조건을 지켜야 한다. 출력 디자인 문서를 OFL로 재라이선스해야 한다는 뜻은 아니다. 전체 OFL 원문은 root notices 두 형식에 포함했다. 원격 Google Fonts 호출은 사용하지 않는다.

## 전체 설치 runtime 트리 기록

[`THIRD_PARTY_NOTICES.json`](../THIRD_PARTY_NOTICES.json)과 [`THIRD_PARTY_NOTICES.txt`](../THIRD_PARTY_NOTICES.txt)는 다음 명령으로 재현한다.

```sh
node scripts/generate-notices.mjs
```

스크립트는 `npm ls --omit=dev --all --long --json`에 나타나는 **68개 설치 위치**를 순회하고, 실제 각 `package.json`의 이름·버전·license·repository와 루트 LICENSE/COPYING/NOTICE/OFL 원문·SHA-256을 수집한다. 중첩 버전도 별도 기록한다. 선언 분포는 MIT 56, Apache-2.0 5, ISC 4, OFL-1.1 1, BSD-3-Clause 1, 메타데이터 없음 1이다. 이 수는 설치 runtime 트리의 위치 수이며 최종 renderer bundle에 포함된 모듈 수와 같지 않다.

Electron은 개발 dependency에 선언되지만 배포 시 실제 런타임이므로 별도 기록한다. 설치된 Electron 배포본의 `LICENSE`와 `LICENSES.chromium.html`을 그대로 보존하며, JSON에 경로·크기·SHA-256을 기록했다. Chromium의 대형 고지 HTML을 임의로 축약하거나 MIT 하나로 대체하지 않는다. Forge는 notices JSON/TXT를 앱 `resources/`에 복사하도록 구성했다.

### 누락 고지의 보완과 실제 배포 범위

`@react-three/fiber@9.8.2`와 `draco3d@1.5.9`의 설치 패키지에는 루트 LICENSE가 없어, 각 공식 릴리스 태그의 원문을 HTTPS로 가져와 `docs/third-party/`에 보존했다. 출처·확인일은 `supplemental.json`, 원문과 SHA-256은 두 notices에 포함했다. `webgl-constants@1.1.1`은 메타데이터에 license가 없지만 실제 동봉 LICENSE의 MIT 허가문과 Copyright 2019 Tim van Scherpenzeel을 근거로 별도 `detectedLicense: MIT`를 기록했다. 패키지 메타데이터 자체를 수정하지 않았다.

`node scripts/audit-bundle.mjs`는 Vite의 실제 `generateBundle` 결과에서 코드가 남은 모듈과 로컬 글꼴 에셋을 집계한다. 재빌드한 JavaScript 청크의 SHA-256을 배포 `dist/`와 비교한 결과가 `docs/bundle-audit.json`이다. 현재 renderer에 실제 포함되는 패키지는 **16종**이며 모두 라이선스 원문을 notices에 포함했다. Electron 배포본의 고지 두 파일도 그대로 보존한다. 설치 트리의 모든 패키지가 배포되는 것은 아니다.

| 설치 트리에 남은 확인 항목 | 선언 라이선스 | 이번 renderer 포함 | 적용 |
|---|---|---|---|
| `@mediapipe/tasks-vision@0.10.17` | Apache-2.0 | 아니오 | 기능 추가로 포함할 때 해당 버전의 고지 확인 |
| `maath@0.10.8` | MIT | 아니오 | 현재 upstream은 다른 버전·이름이므로 설치 버전 고지를 추정하지 않음 |
| `stats-gl@2.4.2` | MIT | 아니오 | README의 MIT 선언은 확인; 기능 추가로 포함할 때 원문 보완 |

Forge 배포에서는 `node_modules`를 제외하고 번들만 포함한다. 위 3개 모듈은 실제 청크에 코드가 없고 패키지 디렉터리도 배포되지 않는다. 이 판정은 현재 번들에 한정되며 의존성·import·빌드 설정 변경 후 audit와 notices를 다시 생성해야 한다. 소스 archive 역시 `node_modules`를 포함하지 않는다.

상용 출시 전에는 자체 앱의 배포 정책, 사용자 에셋 권리, STULOOMA 명칭·상표·도메인·앱 ID·확장자, 대상 운영체제 검증과 코드 서명·공증을 확정해야 한다. 개발용 ZIP은 코드 서명과 대상 OS 출시에 대한 인증을 뜻하지 않는다.
