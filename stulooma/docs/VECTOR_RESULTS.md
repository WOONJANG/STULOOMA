# STULOOMA 0.3.0 Vector Studio

기존 앱에 벡터 편집·저장·SVG·의류 연결을 통합했다. 별도 앱이나 정적 화면이 아니다. 펜으로 만든 cubic 경로와 직접 편집한 앵커가 프로젝트 v2에 남고, 연결한 아트보드의 변경이 기존 3D UV 텍스처에 반영된다. 이전 v1 프로젝트와 원본 PNG/GLB는 보존한다. 상용 벡터 제품의 전체 기능·SVG 전체 호환·출시 인증을 주장하지 않는다.

## 실행·예제

[0.3.0 개발판 릴리스](https://github.com/WOONJANG/STULOOMA/releases/tag/v0.3.0-dev)에서 실행 ZIP과 소스를 받는다. Windows에서는 ZIP 전체를 새 폴더에 풀고 `STULOOMA-win32-x64/STULOOMA.exe`를 실행한다. Linux는 `STULOOMA-linux-x64/STULOOMA`다. `resources`와 런타임 파일을 함께 유지한다.

프로젝트 예제는 [복합 패스·그라디언트·앞판 연결](../../samples/projects/vector-compound-3d.stulooma), [한글 실제 윤곽선](../../samples/projects/vector-korean-outlines.stulooma), [설명](../../samples/projects/VECTOR_README.md)에 있다. SVG fixture는 [samples/vector](../../samples/vector/)에 있다.

## 실제 추가 동작

- 같은 프로젝트·메뉴·Undo/Redo·dirty·자동 복구를 사용하는 Vector Studio. 기존 3D와 함께 보이는 graphite 화면, 도구·속성·레이어·아트보드.
- 선택/직접 선택, 여러 객체, 펜의 실제 cubic handles와 열린/닫힌 경로, 앵커 추가/삭제/분리/이어그리기, 기본 도형·변형·정렬.
- 실제 새 경계를 계산하는 union/difference/intersection/xor/divide와 복합 패스. 구멍은 투명하며 흰 덮개나 래스터로 대체하지 않는다. Boolean 곡선은 기본 0.25 문서 px 근사다.
- 그룹·순서·표시·잠금, 선/칠/불투명도, 선형/방사형 그라디언트, 클리핑, 다중 아트보드, SVG/PNG 출력.
- 한국어/영문 편집 문자와 자간. 수정 없는 OFL Noto Sans CJK KR Regular 400의 실제 OpenType 글리프를 편집 가능한 윤곽선으로 변환한다. 지원 밖 font/weight는 오류로 알린다.
- 비신뢰 SVG를 허용 목록으로 해석하고 typed 문서로 정규화한다. script/event/외부 자원/DOCTYPE/entity/손상·과도한 입력을 거부하며 미지원 효과를 경고한다. 원본 markup을 DOM에 삽입하지 않는다.
- 벡터 문서/아트보드를 기존 의류 artwork layer에 연결한다. 편집 원본과 렌더를 분리하고 원래 레이어 배치·혼합 순서·원본 에셋을 유지한다. 벡터 없는 문서는 v1, 벡터 추가 후 v2로 저장한다.

## 검증 결과

보관 로그는 줄 끝 공백만 정리했으며 검사 내용과 결과는 유지했다. 최종 실행 결과다. 고유 자동 검사 **175개(147 + 24 + 4)가 통과**, 실패·skip·예상 실패는 0개다. 단위와 집중 UI 검사를 전체 검사에 중복 합산하지 않는다. Linux 패키지 재실행도 같은 Electron 검사이므로 고유 검사 수와 구분한다.

| 검사 | 실제 결과 | 증거 |
|---|---|---|
| TypeScript + production renderer/main/preload | 통과 | [빌드](evidence/vector-0.3.0/build-final.txt) |
| 단위·보안 | 147 passed, 10 files | [로그](evidence/vector-0.3.0/unit-final.txt) |
| 전체 실제 Chromium/WebGL | 24 passed | [로그](evidence/vector-0.3.0/e2e-final.txt) |
| production Electron | 4 passed | [로그](evidence/vector-0.3.0/native-final.txt) |
| Linux 패키지 실제 실행 | 같은 4개 재검사 통과 | [로그](evidence/vector-0.3.0/native-packaged.txt) |
| Linux/Windows ZIP | CRC·ELF/PE·137개 renderer/main/preload/글꼴 파일·고지·버전·app.asar 일치 | [무결성](ARTIFACTS.json) |

기존 반팔·농구 앞뒤 디자인, PNG·GLB 원본 바이트, UV·내 모델·재질, 프로젝트 저장/열기, 자동 복구, 작업 공간·단축키·클립보드·출력 회귀를 포함한다. 새 검사는 실제 경로 변경·정확한 샘플 픽셀·WebGL 변경·shared history·편집 가능한 재열기·native 파일을 확인한다.

최종 검토에서 잠긴 객체/상위 그룹의 직접 편집과 변형된 열린 패스의 이어그리기 좌표를 보완했고, 불투명도 마스크의 복사/아트보드 복제 참조를 재매핑했다. 각 경우를 실제 UI 회귀에 추가했다. 좌표와 자간은 입력 중 부호·소수를 로컬에 보관하고 Enter/blur 때 반영해 음수 타이핑과 한 번의 Undo를 보존한다. 한글 text draft는 blur/저장/닫기 때 한 번에 commit하며, 저장된 문서의 입력 중 초안을 버리려 할 때도 닫기 취소를 확인한다.

Electron 초기 실행 한 번은 종료된 Xvfb 때문에 실행 전에 실패했다. 기존 display helper를 다시 시작한 뒤 재검사했다. 컨테이너 시험 전용 `--no-sandbox`는 배포 앱 설정에 넣지 않았다. 최종 native 재검사 한 번은 UI 로드 전 기본 5초 assertion이 시작되어 startup 검사가 실패했다([원본 로그](evidence/vector-0.3.0/native-before-load-wait.txt)). 다른 native 검사와 같은 기준으로 로컬 `app://` URL과 DOMContentLoaded를 기다린 뒤 기존 내용·3D·저장 검증을 수행하도록 동기화했다. 검증 내용·assertion 대기 제한을 줄이거나 생략하지 않았다. Vite의 단일 청크 크기 경고와 Three.js Clock deprecation 경고는 남아 있으며 빌드/검사 실패와 구분한다.

## 개발 보고 표

| 항목 | 실제 결과 |
|---|---|
| 대상 프로그램 / 추가 기능 | STULOOMA / Vector Studio 0.3.0 |
| 측정 작업 구간 | 2026-10-18 21:23:30–22:12:55 KST, 49분 25초 (경과 시간, 게시 전 코드·검사 구간) |
| 수정/추가 파일·신규 코드 줄 | 수정 32개, 추가 74개, 삭제 0개. 앱·Electron·빌드 스크립트 26개 파일에서 +6679/−78줄. 문서·테스트·lockfile·바이너리는 코드 줄 집계에서 제외 |
| 고유 자동 검사·통과·실패 | 175개 / 175 passed / 0 failed·0 skipped |
| 기존 회귀 | 기존 단위·보안 79개와 브라우저 9개, 기존 native 3개 포함 전체 통과 |
| 실행 파일 | `out/STULOOMA-linux-x64/STULOOMA`, `out/STULOOMA-win32-x64/STULOOMA.exe` |
| ZIP 크기·SHA-256 | [ARTIFACTS.json](ARTIFACTS.json) |
| 미구현·검증 한계 | [VECTOR_GAPS.md](VECTOR_GAPS.md) |

## 시연 순서

약 3분의 안내용 순서이며 동영상 길이나 사용자 작업 속도의 실측값은 아니다.

1. 기존 프로젝트를 열고 **Vector Studio**로 이동한다.
2. 사각형·타원을 만들고 전체 선택 → **앞면 빼기**로 실제 경계를 만든다. **직접 선택**에서 앵커를 움직인다.
3. 문자 도구로 한국어/번호를 입력하고 **문자 윤곽선 만들기**를 사용한다. 경로/그룹을 선택해 색상·배치를 조정한다.
4. 적용 부위를 고르고 **현재 아트보드 적용**을 누른다. 3D를 회전하고 벡터 칠을 바꿔 실시간 갱신을 확인한다.
5. 프로젝트 저장 → 새 프로젝트 → 다시 열기 후 앵커를 계속 편집한다. Vector Studio의 SVG/PNG와 기존 내보내기의 목업 PNG를 저장한다.

## 출시 범위

Linux/Xvfb에서 실제 실행했고 Windows ZIP은 Linux 교차 제작·구성 검사다. Windows/macOS GUI, 실제 OS 한글 IME, 코드 서명·SmartScreen 평판은 검증하지 않았다. PDF, 패스 위 문자, 획 확장, Image Trace/Offset, CMYK/ICC·제조 CAD·물리 착의는 미구현이다. 로컬 RGB 목업·벡터 편집 개발판으로 제공한다.

현재 renderer의 19개 npm 패키지와 내장 하위 코드·OFL 글꼴, Electron/Chromium 고지를 보존했다. `polygon-clipping` UMD에 내장된 splaytree 3.1.2(MIT)와 Microsoft helper(Apache-2.0)도 별도 고지했다. 출처와 해시는 [LICENSES.md](LICENSES.md), [notices](../THIRD_PARTY_NOTICES.json)에 있다.

측정 근거는 [development-measurements.json](evidence/vector-0.3.0/development-measurements.json), 패키지 내용 비교는 [artifacts-verified.txt](evidence/vector-0.3.0/artifacts-verified.txt)다. 위 파일 수는 이 결과와 측정 기록을 포함한 게시 전 diff 기준이다.

[뒷판·그룹·클리핑·아트보드](evidence/vector-0.3.0/vector-back-clip-artboard.png) · [복합 패스와 실제 3D](evidence/vector-0.3.0/vector-compound-3d.png) · [펜 핸들](evidence/vector-0.3.0/vector-pen.png) · [한글 윤곽선](evidence/vector-0.3.0/vector-korean-outlines.png)
