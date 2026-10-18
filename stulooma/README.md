# STULOOMA

한국어로 사용하는 로컬 3D 의류 디자인·목업 편집기입니다. 독립 제작한 반팔 티셔츠와 민소매 농구 상의에 PNG·텍스트를 배치하고, 실제 3D로 회전해 확인하며, 편집 가능한 `.stulooma` 프로젝트와 PNG/JPG/GLB를 저장합니다.

현재 버전은 **0.3.0 개발판**입니다. 두 기본 의류의 편집·저장·복원·출력을 Linux에서 검증했습니다. Windows/macOS 실제 실행과 출시 검증은 남아 있습니다. 검증 결과와 한계는 [테스트 기록](docs/TEST_PLAN.md), [미구현·제약](docs/GAPS.md), [배포 안내](docs/RELEASE.md)에 구분해 기록합니다.

## 실행

Node.js **24 LTS**와 npm을 사용합니다. 이 환경에서 확인한 버전은 Node 24.19.0 / npm 11.9.0입니다. 저장소의 기존 checkout에서 실행하세요.

```sh
cd /workspace/STULOOMA/stulooma
npm ci --cache /workspace/.cache/npm
npm run dev:desktop
```

읽기 전용 home과 관리형 프록시를 사용하는 이 클라우드 환경에서 재설치할 때는 Electron의 공식 downloader가 기존 프록시를 사용하도록 설정할 수 있습니다. TLS와 Electron 체크섬 검증은 유지합니다.

```sh
NODE_USE_ENV_PROXY=1 electron_config_cache=/workspace/.cache/electron npm ci --cache /workspace/.cache/npm
```

`npm run dev`는 같은 편집기의 브라우저용 개발 서버를 실행합니다. 브라우저는 프로젝트·출력을 다운로드하고 Electron은 네이티브 파일 대화상자를 사용합니다. Electron main/preload 코드를 바꾼 뒤에는 개발 명령을 재시작합니다. npm 의존성과 Electron 바이너리가 설치된 뒤 일반 앱 사용에는 외부 서버·API 키·클라우드 계정이 필요하지 않습니다.


클라우드 환경을 그대로 재설치·빌드·검증하려면 다음 명령을 사용합니다. source와 lockfile을 변경하지 않습니다.

```sh
bash scripts/setup-cloud.sh
```

클라우드에서 네이티브 시험을 실행하려면 다음을 사용합니다. `--no-sandbox`는 이 제한된 컨테이너의 시험 실행에만 적용하며, 일반 데스크톱 실행이나 배포 설정에 추가하지 않습니다.

```sh
bash scripts/setup-cloud-display.sh --start
source /workspace/.cache/system/display.env
STULOOMA_CI_NO_SANDBOX=1 npm run test:desktop
```

## 0.3.0 Vector Studio

상단 **Vector Studio**를 열고 펜·도형·직접 선택으로 로고를 편집합니다. SVG를 가져오거나 한글 문자를 입력하고, 필요한 경우 실제 글꼴 경로로 윤곽선을 만듭니다. **현재 아트보드 적용**으로 앞판/뒤판 등 의류 부위에 연결하면 벡터 편집이 3D에 반영됩니다. 저장한 `.stulooma`를 다시 열어 경로와 연결을 계속 편집할 수 있습니다.

Boolean 합치기/빼기/교차/제외, 복합 패스의 투명 구멍, 그룹·클리핑·그라디언트, SVG/PNG 출력을 제공합니다. 벡터가 추가된 프로젝트는 v2이며 이전 0.2.0 앱에서는 열리지 않습니다. 원본 PNG/GLB는 보존됩니다. [벡터 기능](docs/VECTOR_SPEC.md), [검증 결과](docs/VECTOR_RESULTS.md), [호환성·남은 기능](docs/VECTOR_GAPS.md)을 확인하세요.

## 0.2.0 작업 공간 패치

- 파일·편집·디자인·보기 메뉴와 `Ctrl/⌘+K` 명령 검색, 우클릭 레이어 메뉴
- 라이브러리·속성 패널 너비/표시 상태 저장, 항상 접근할 수 있는 레이어 패널과 편집 기록
- 레이어 복사/붙여넣기·정렬·미세 이동·이름 변경, 잠금 보호와 저장 상태 복원
- 2D 확대·맞춤, Space/휠 이동, 그리드·스냅·스마트 가이드, 15° 회전
- 데스크톱 `Ctrl/⌘+S` 반복 저장과 `Ctrl/⌘+Shift+S` 다른 이름으로 저장
- PNG·GLB·프로젝트를 화면에 놓아 가져오기

## 기본 사용

1. 왼쪽에서 반팔 또는 농구 유니폼을 선택합니다.
2. 앞판/뒤판 등 편집 부위를 고르고 색상과 원단 표현을 조정합니다.
3. **이미지 추가**로 PNG를 가져옵니다. 2D 화면에서 이동하고 오른쪽에서 크기·회전·불투명도를 바꿉니다. 텍스트도 별도 레이어로 편집할 수 있습니다.
4. 3D 화면을 드래그해 회전하거나 정면·후면 버튼으로 디자인을 확인합니다. 실행 취소/다시 실행으로 변경을 복원합니다.
5. **저장**으로 `.stulooma`를 만들고 **열기**로 다시 편집합니다. 원본 이미지와 레이어를 보존합니다.
6. **내보내기**에서 PNG/JPG/GLB를 선택합니다. PNG는 1024/2048/4096 해상도와 투명 배경을 선택할 수 있습니다. 실제 출력 가능 크기는 장치의 WebGL 한도를 따릅니다.

사용자 모델은 **GLB 모델 가져오기**에서 검사한 뒤 mesh별 앞판/뒤판 등을 지정해 내 모델에 등록합니다. 외부 URI 없는 자체 포함 glTF 2.0 GLB와 유효한 UV가 필요합니다. 단일 mesh의 일부 삼각형을 나누거나 UV를 자동 생성하는 기능은 없습니다. 원본 파일은 사용 권한을 확보한 자료를 선택하세요.

프로젝트와 사용자 모델은 기본적으로 로컬에 보관됩니다. 복구 데이터는 로컬 IndexedDB에 저장되며 수동 프로젝트 저장을 대신하지 않습니다. 비정상 파일은 오류를 표시하고 기존 디자인을 유지합니다.

## 개발·검증 명령

| 명령 | 용도 |
|---|---|
| `npm run generate:assets` | 원본 3D GLB·시험용 PNG/패턴/SVG/손상 파일 생성 |
| `npx tsx scripts/generate-project-sample.ts` | 편집 가능한 한글 예제 프로젝트 생성·round-trip 확인 |
| `node scripts/audit-bundle.mjs && node scripts/generate-notices.mjs` | production 빌드와 일치하는 실제 번들·runtime 라이선스 기록 갱신 |
| `npm run typecheck` | TypeScript 검사 |
| `npm test` | Vitest 단위·보안 검사 |
| `npm run test:e2e` | 실제 Chromium/WebGL 편집 흐름 |
| `npm run test:desktop` | 실제 Electron UI·네이티브 저장·열기·bridge 검사 |
| `npm run build` | renderer와 Electron main/preload production 빌드 |
| `npm run package:linux` | Linux x64 실행 ZIP |
| `npm run package:win` | Windows x64 Portable ZIP |

브라우저 E2E는 기본 `/usr/bin/chromium`을 사용합니다. 다른 Chromium을 사용하면 `STULOOMA_CHROMIUM=/절대/경로/chromium npm run test:e2e`로 지정합니다. Playwright browser를 따로 설치한 경우에도 이 실행 경로를 명시해야 합니다. GUI 검사에는 OS 라이브러리와 디스플레이가 필요합니다. 이 Linux 컨테이너에서는 Xvfb와 시험 전용 sandbox 예외를 사용하므로 정상 OS sandbox 동작은 별도 검증 대상입니다. 재현 방법과 한계는 [RELEASE.md](docs/RELEASE.md)에 있습니다.

## 실행 패키지

이 환경에서 생성한 패키지는 Linux x64 ZIP(로컬 `out/make/zip/linux/x64/`)과 [Windows x64 Portable ZIP](https://github.com/WOONJANG/STULOOMA/releases/tag/v0.3.0-dev)입니다. 실행 결과와 무결성 정보는 [RELEASE.md](docs/RELEASE.md)에 기록합니다. Windows에서는 ZIP을 풀어 `STULOOMA.exe`, Linux에서는 `STULOOMA`를 실행합니다. macOS 앱 번들은 이 Linux 작업에서 검증하지 않았습니다. 배포 ZIP은 서명되지 않은 개발용이며 Windows 네이티브 실행·코드 서명·설치 연결은 별도 확인이 필요합니다.

## 자료와 라이선스

[전체 요구사항](docs/MASTER_PROMPT.md), [기능 명세](docs/SPEC.md), [UI](docs/UI_SPEC.md), [아키텍처](docs/ARCHITECTURE.md), [파일 형식](docs/FILE_FORMAT.md), [모델 안내](docs/MODEL_GUIDE.md), [클린룸 기록](docs/CLEANROOM.md)을 제공합니다. 개발자는 [CLAUDE.md](CLAUDE.md)를 먼저 읽습니다.

기본 의류·아이콘·시험용 도형은 자체 제작했습니다. 한글 글꼴은 로컬 번들 **Noto Sans KR Variable 및 Noto Sans CJK KR Regular (OFL-1.1)**, 범용 아이콘은 Lucide (ISC)입니다. 런타임 의존성과 원문 고지는 [LICENSES.md](docs/LICENSES.md), [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), [기계 판독 기록](THIRD_PARTY_NOTICES.json)에 있습니다. 자체 애플리케이션은 현재 `UNLICENSED`이며 의존성 라이선스가 앱 전체의 배포권을 부여하지 않습니다. 상용 배포 전 자체 배포 정책·상표·코드 서명·OS별 검증이 남아 있습니다. 현재 renderer에 포함된 19종 라이브러리와 내장 하위 코드·글꼴의 라이선스 원문을 동봉했습니다.
