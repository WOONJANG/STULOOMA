# STULOOMA 0.1.0 실제 구현·검증 결과

검증일: 2026-10-18 (Asia/Seoul). P0 중심의 로컬 개발판을 구현했다. **Linux에서 동작하는 핵심 흐름을 검증했으며 Windows/macOS까지 검증한 상용 완성판으로 선언하지 않는다.**

## 최종 보고 표

| 항목 | 실제 결과 |
|---|---|
| 프로그램명 | STULOOMA |
| 구현 버전 | 0.1.0 개발판 |
| 작업 시간 | 계측 구간 10-18 02:56:50–10-18 03:46:22 KST, 경과 49분 32초. 대기·중단 포함, 최초 텍스트 열람 등 계측 전 작업 제외 |
| 소스코드 파일 수 | 49개 |
| 전체 코드 줄 수 | 3,785 physical lines. 주석·테스트 포함; `.ts/.tsx/.mjs/.cjs/.css/.html/.sh`. 의존성·출력·문서 제외 |
| 자동 테스트 수 | 고유 test() 78개: Vitest72 + 실제 Chromium4 + 실제 Electron2 |
| 통과 테스트 수 | 78개 |
| 실패 테스트 수 | 최종 실행 0개 |
| skipped / unrun | 해당 78개 중 0개. 대상 OS·실제 IME·성능 검증은 별도 미실행 |
| 구현된 기본 의류 모델 | 2종: 반팔 티셔츠·민소매 농구 상의. 원본 곡면 메시·부위 UV·법선·열린 목과 소매/밑단 |
| 검증된 운영체제 | Linux Debian13 x86_64 클라우드, Chromium SwiftShader, Electron44.9.0/Xvfb |
| 실제 실행 파일 | `out/STULOOMA-linux-x64/STULOOMA` (직접 실행·시험), `out/STULOOMA-win32-x64/STULOOMA.exe` (생성·PE 헤더/포장 검사; Windows 실행 미검증) |
| 미구현·검증 제한 | [GAPS.md](GAPS.md) |

파일별 집계 근거는 [metrics.json](evidence/metrics.json), ZIP 크기·SHA-256은 [ARTIFACTS.json](ARTIFACTS.json)에 있다. Electron test2개를 소스 실행과 패키지 실행에서 반복했지만 고유 테스트 수를 중복 집계하지 않았다.

## 실제로 확인한 작업 흐름

- 반팔: 투명 PNG를 앞·뒷판에 적용, 2D 드래그·크기·회전, 독립 색상·재질, Undo/Redo, 3D 카메라·분할 보기, 한글 텍스트, 저장·재열기와 원본·위치·카메라 보존.
- 출력: 반팔 2048×2048 투명 PNG, 농구복 1024×1024 투명 PNG, 1024×1024 JPG를 실제 디코딩하여 해상도·알파·색이 있는 픽셀과 JPEG 헤더를 검사했다. 편집한 GLB를 다시 가져와 UV·메시를 확인했다.
- 사용자 모델: GLB 검사와 메시별 부위 지정, 로컬 라이브러리 재시작 보존, 사용자 모델에 새 PNG 배치, 프로젝트 저장·재열기에서 GLB/PNG 원본과 편집 레이어 보존.
- 자동 복구: 실제 IndexedDB 저장 후 새로고침·복구 선택으로 한글 앞뒤 디자인과 원본 PNG 복원.
- 오류: 손상 프로젝트·GLB·UV 없는 모델 거부 후 기존 프로젝트 보존. ZIP 경로 순회·CRC·중복·실제 DEFLATE 팽창·참조 오류 검사.
- 데스크톱: 실제 Linux 배포 실행 파일로 3D 준비·네이티브 파일 저장/열기·시작 인자 프로젝트·변경 사항 종료 확인·제한 preload·Node 부재·외부 요청/창 차단 검사.
- 최종 렌더에서 발견한 어깨의 로고 반복은 상단 UV 연속 영역으로 보정했다. 논리 부위가 여러 메시일 수 있으므로 UV 전체 범위는 부위 단위로 검증하며 어깨가 중앙 디자인을 반복하지 않는 회귀 조건을 포함했다.

[편집 화면](evidence/tee-editor.png), [반팔 PNG](evidence/tee-transparent-2048.png), [농구 PNG](evidence/basketball-transparent-1024.png), [사용자 모델](evidence/custom-model-editor.png)을 확인할 수 있다.

## 검증 로그

| 명령 | 결과 | 근거 |
|---|---|---|
| `bash scripts/setup-cloud.sh` | 실제 frozen 재설치·빌드·테스트 성공, lockfile SHA-256 유지 | [설치 로그](evidence/reproducible-install.txt) |
| `npm run typecheck` | 성공 | [로그](evidence/typecheck.txt) |
| `npm test` | 72 passed, 0 failed | [로그](evidence/unit-tests.txt) |
| `npm run test:e2e` | 4 passed, 브라우저 오류 없음 | [로그](evidence/browser-tests.txt) |
| `npm run build` | production renderer/main/preload 성공 | [로그](evidence/production-build.txt) |
| 실제 packaged Linux `npm run test:desktop` | 2 passed, 시험 전용 sandbox override 사용 | [로그](evidence/packaged-desktop-tests.txt) |
| Forge Linux/Windows make | ZIP 생성·CRC·실행 파일 형식·현재 코드/고지 일치 성공 | [포장 검사](evidence/packaged-files.json) |

초기 시험에서 CSP가 GLB의 로컬 blob 텍스처 요청을 막는 문제가 있어 `connect-src`에 `blob:`만 허용했다. 외부 URI 금지는 유지했다. 글꼴 family/로딩과 카메라 프레이밍도 실제 화면으로 수정했다. 실패했던 검사를 삭제하거나 비활성화하지 않았으며 최종 위 실행에서 모두 통과했다. UI 테스트의 좌표 비교는 포인터의 부동소수 오차 범위로 검증하고, 내 모델 탭에서 새 프로젝트를 여는 경로를 실제 UI에 맞췄다.

## 실행 패키지

| 플랫폼 | ZIP 크기 | SHA-256 |
|---|---:|---|
| linux x64 | 128,229,776 bytes | `f753e534984e22cb21ebb657ce15057e7d67f06030bb0d66e168d7bf994167b6` |
| win32 x64 | 163,617,598 bytes | `7383eae4541fd5d7f88273a9e7a56065646d1ea729ffeb2edd78590ce90cc2d8` |

ZIP은 unsigned 개발용 Portable 배포다. Linux에서는 압축을 풀고 `STULOOMA`, Windows에서는 `STULOOMA.exe`를 실행하는 구조다. Windows ZIP을 Linux에서 만들었다는 사실은 Windows 실행 검증을 뜻하지 않는다. macOS 앱은 이 작업에서 생성하지 않았다.

## 재사용 환경과 보존 상태

환경 설정 초안에 `install_script`, `start_skill`, 실제 `STULOOMA` checkout 경로를 저장했고 read-back으로 보존을 확인했다. 설치는 기존 checkout에서 frozen `npm ci`를 사용한다. 별도 API 키·서버·DB는 필요 없다. 정상 TLS·패키지/바이너리 체크섬과 Debian 서명 검증을 유지했다.

초안 저장은 게시와 다르다. 환경 설정에서 검토·저장 후 게시해야 스냅샷/설정이 활성화된다. 새로운 작업에서 복원되는 과정은 아직 실행하지 않았다. 원격 저장소는 원래 커밋이 없는 상태이며 이 작업의 소스는 작업공간과 소스 ZIP에 있다. 최초 검증 시점에는 Git 커밋·푸시를 수행하지 않았다. 이후 사용자가 승인한 GitHub 전달과 다운로드 정보는 저장소 최상위 README 및 개발판 릴리스를 따른다.

Xvfb 시험은 이 제한된 컨테이너에서만 `--no-sandbox`를 사용했다. 배포 코드의 `sandbox: true`/context isolation 설정과 실제 OS 프로세스 sandbox 검증을 구분한다. Windows/macOS 실제 실행, OS 한글 IME, 서명·공증, 실물 인쇄 색상·성능 수치는 미검증이다. 후드·의류 패턴 CAD·치수 편집·마네킹·물리 시뮬레이션 등 P1–P3의 남은 기능은 [GAPS.md](GAPS.md)에 있다.
