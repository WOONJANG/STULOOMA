# STULOOMA 개발 규칙

코드를 작성하기 전에 이 규칙과 관련 명세를 읽는다. 아키텍처·형식·동작을 바꾸면 대응 문서를 함께 갱신한다.

## 1. 프로젝트 소개

실제 3D 의류에 PNG·텍스트를 배치하고 회전 목업·프로젝트 저장·이미지 출력을 수행하는 로컬 우선 데스크톱 도구다. P0 데이터 보존과 실제 동작이 우선이다. 정적 목업을 정확한 착의·물리·제작 시뮬레이션으로 표현하지 않는다.

## 2. 공식 명칭

표시명 **STULOOMA**, 패키지 `stulooma`, 앱 ID `com.stulooma.desktop`, 프로젝트 `.stulooma`. Windows `STULOOMA.exe`, macOS `STULOOMA.app`를 목표로 한다. 실제 검증 OS와 패키지 상태를 분리해 보고한다.

## 3. 클린룸 원칙

타사 소프트웨어의 구현·비공개 포맷·고유 UI·모델·마네킹을 복사하거나 추출하지 않는다. 기본 반팔과 농구 모델은 독립 제작한 파라메트릭 메시다. 실제 참고·제작 이력은 `docs/CLEANROOM.md`에 추가한다.

## 4. 허용·금지 자료

허용: 공개 공식 사용자 도움말, glTF/PNG/SVG 공개 규격, 범용 라이브러리 공식 문서, 사용자에게 사용 권한이 있는 파일. 금지: 경쟁 앱 소스, 디컴파일, 비공개 API 추출, 권리 불명 폰트·모델, 독점 형식 완전 호환 주장. 접근 못한 문서를 읽었다고 기록하지 않는다. 출처는 `docs/SOURCES.md`.

## 5. 기술 스택

Electron/Node/TypeScript/Vite/React 19, Three.js/Fiber 9/Drei, Canvas 2D, Zustand, fflate, Vitest, Playwright, Electron Forge. React와 Fiber major를 맞춘다. lockfile 고정 설치를 사용한다. 로컬 CSS 토큰을 사용하며 기술 대체 사유는 아키텍처에 기록한다.

## 6. 폴더 구조

`electron/{main,preload,ipc}`는 데스크톱 경계, `src/types`는 문서 계약, `src/state`는 편집 상태, `src/core`는 프로젝트·검증·모델·입출력, `src/components`/`src/app`은 화면, `scripts`는 재현 가능한 생성·빌드, `samples`는 시험 자료, `tests`는 실제 검사, `docs`는 명세·증거·제약이다. 빈 폴더만 추가해 기능 완료로 보고하지 않는다.

## 7. 모듈 책임

컴포넌트에 파일 파서·ZIP 검증·메시 생성·역직렬화를 몰아넣지 않는다. 도메인 모델은 직렬화 가능한 `ProjectDocument`; React/GPU 객체와 Node 파일 권한을 포함하지 않는다. 모듈 입출력은 `docs/ARCHITECTURE.md`를 따른다.

## 8. 명령·히스토리

메뉴/버튼/단축키는 같은 애플리케이션 명령을 사용한다. 문서 편집은 typed EditCommand와 Zustand history를 거친다. drag는 beginGroup/endGroup으로 한 기록, 새 작업은 redo 제거. 카메라·선택·파일 대화상자와 편집 Undo를 구분한다. ID·인자·조건·Undo·테스트는 `docs/COMMANDS.md`에 기록한다.

## 9. 파일 형식

`.stulooma`는 버전 1/2 ZIP/JSON과 원본 에셋. 벡터 없는 문서는 v1을 유지하고 벡터 문서는 v2를 사용한다. 원본 이미지·GLB 바이트와 편집 가능한 레이어·부위·재질·카메라를 보존한다. 미래 버전이나 미지원 필수 구조는 경고하고 덮어쓰지 않는다. 경로/팽창/중복/필드 검증을 선행한다. `docs/FILE_FORMAT.md`를 따른다.

## 10. 에셋·라이선스

자체 생성 에셋은 생성 스크립트와 출처를 남긴다. 외부 에셋을 추가하기 전에 권리와 상용 재배포 조건을 확인하고 `docs/LICENSES.md`를 갱신한다. Noto Sans KR Variable을 OFL-1.1과 고지를 포함해 로컬 번들한다. 추가 폰트는 라이선스 확인 없이 포함하지 않는다. 프로젝트 자체 라이선스는 상용 출시 전 결정한다.

## 11. UI 가이드

한국어, 작업 중심 다크 UI, 명확한 선택과 저장/오류 상태, 실제 2D·3D 연동. 모델·버튼·형식은 구현한 항목만 제공한다. IME 조합 중 전역 키를 가로채지 않고 입력 필드의 기본 편집을 보존한다. 세부 동작은 `docs/UI_SPEC.md`.

## 12. 보안

Electron contextIsolation/sandbox 활성, Node integration 비활성, 최소 preload API, IPC 발신자·인자 검증, CSP와 외부 탐색 차단. 파일은 확장자뿐 아니라 헤더·구조·크기·픽셀 수를 검사한다. GLB 외부 자원 접근을 제한하고 SVG는 안전 처리기 없이는 받지 않는다. 경로 순회·ZIP bomb·중복 경로를 거부한다. 사용자 동의 없는 원격 업로드·분석을 추가하지 않는다. 패키지 서명·TLS·checksum 검증을 끄지 않는다.

## 13. 테스트 명령

`npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:desktop`. 생성 자료가 필요한 경우 `npm run generate:assets`를 먼저 실행한다. 성공 여부는 실제 로그로 판단한다. 필수 round-trip·보안·실제 UI 동작을 단순 스냅샷으로 대체하지 않는다. 테스트 계획·환경·실패는 `docs/TEST_PLAN.md`에 기록한다.

## 14. 실행·빌드 명령

`npm ci`, `npm run dev`(웹 개발), `npm run dev:desktop`(Electron 개발), `npm run build`, `npm run package:linux`, `npm run package:win`. 기존 checkout과 lockfile을 사용한다. 클라우드 작업은 이미 격리되어 있으므로 사용자가 명시적으로 요청하지 않으면 Git worktree를 만들지 않는다. Windows ZIP 생성과 Windows 네이티브 실행·코드 서명을 구분한다.

## 15. 완료 기준

실제 코드 → UI 실행 → 문서 데이터 변경 → 2D/3D 반영 → 저장/재열기 → 오류 처리 → 관련 테스트 통과 → 문서 일치의 전체 흐름을 확인해야 완료다. 모든 P0 인수 흐름 검증 전 최초 완성판으로 선언하지 않는다. 미구현·검증하지 못한 항목은 `docs/GAPS.md`에 남긴다. 보고는 실제 결과를 기준으로 완료/검증/남은 작업을 구분한다. 측정하지 않은 성능·작업 시간·테스트 수를 추정하지 않는다.

## 16. Vector Studio 개발 규칙

- 공개 Adobe 사용자 도움말과 W3C SVG 규격의 관찰 가능한 동작만 참고한다. 타사 앱 소스·디컴파일·고유 자산·AI 비공개 편집 데이터를 사용하지 않는다. 실제 접근 근거는 `docs/VECTOR_CLEANROOM.md`에 기록한다.
- `src/types/vector.ts`는 JSON 계약, `src/core/vector`는 문서·기하·Boolean·검증·SVG·렌더·문자, `src/features/vector-studio`는 편집 UI다. 빈 폴더·버튼만으로 완료로 표시하지 않는다.
- 기존 ProjectDocument·의류 UV·3D Viewer·Texture Composer·asset bytes를 재사용한다. vector artwork layer는 vector document/artboard ID를 참조하며 편집 원본과 3D용 렌더를 분리한다.
- 좌표·핸들·6성분 affine matrix는 문서 데이터다. viewport zoom/pan·React/GPU 객체·Electron 경로/권한은 문서에 저장하지 않는다. ID·참조·부모·clip/mask 순환·숫자/복잡도 제한을 검증한다.
- SVG는 허용 목록 기반 비실행 XML 입력으로 정규화한다. script/on*·외부자원·DOCTYPE/entity·손상XML·과도한경로/계층을 거부한다. 원본 markup을 실행 DOM에 삽입하지 않는다. 미지원 기능 손실을 경고하고 AI/PDF/SVG 완전 호환을 주장하지 않는다.
- 모든 vector 문서 편집·garment binding은 기존 typed EditCommand/history/dirty를 사용한다. 별도 vector Undo를 만들지 않는다. drag는 한 기록이며 Undo/Redo는 벡터와 3D를 함께 복원한다.
- vector 도구 키는 해당 작업 공간이 소유한다. 기존 공통 파일/Undo/검색키를 중복 실행하지 않는다. 입력·IME·조합229·처리된 이벤트를 우선한다.
- 벡터가 없는 기존 프로젝트는 v1을 유지한다. vectorDocuments 또는 vector layer를 추가하면 프로젝트v2를 사용한다. 새 앱은v1/v2를 읽고 구앱은v2를 안전 거부한다. 원본PNG/GLB는 재인코딩하지 않는다.
- 관련 명세는 `docs/VECTOR_{SPEC,UI_SPEC,ARCHITECTURE,FILE_FORMAT,INTEGRATION_AUDIT,TEST_PLAN,GAPS}.md`다. `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run test:desktop`와 실제 editable SVG/project roundtrip·악성SVG·3D alpha/UV·기존 회귀를 확인한다.
- 완료는 실제 UI→데이터→렌더→Undo→저장/재열기→오류→자동검사→기존회귀까지 확인한 상태다. Boolean 경계를 래스터로, 구멍을 흰색 덮개로, 문자 윤곽선을 PNG로 위장하지 않는다. 미구현 P1/P2/P3·플랫폼/IME/성능 미검증을 GAPS에 남긴다.
