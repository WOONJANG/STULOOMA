# 클린룸 개발 기록

작성일: 2026-10-18 (Asia/Seoul). 이 문서는 이번 작업에서 실제 사용한 자료와 제작 경계를 기록한다. 법적 권리 검토나 상용 출시 승인을 대신하지 않는다.

## 입력과 독립 구현

| 항목 | 실제 출처 / 방법 | 권리·제약 |
|---|---|---|
| 기능 요구 | 사용자가 제공한 STULOOMA 마스터 프롬프트 | P0 편집·저장·출력 흐름을 기준으로 독립 설계 |
| 공식 자료 | [SOURCES.md](SOURCES.md)의 SRC-002–008 | 공개 규격과 범용 라이브러리 기술 문서. CLO 사이트는 접속 차단으로 사용하지 못함 |
| 반팔 / 농구 저지 | `src/core/garments/index.ts`의 자체 파라메트릭 정점·인덱스·UV 생성 | 타사 모델, 템플릿, 마네킹 추출 없음. 프로젝트 배포 라이선스 결정 필요 |
| 샘플 PNG·체크 패턴·SVG | 로컬 생성 스크립트로 만든 시험용 도형 | 외부 로고·일러스트·폰트를 포함하지 않음 |
| UI | STULOOMA 자체 화면 구성, 따뜻한 graphite / teal 색상 | 경쟁 제품 고유 그래픽·로고 재사용 없음 |
| 텍스트 | `@fontsource-variable/noto-sans-kr@5.3.1` 로컬 CSS/WOFF2 | Noto Sans KR Variable, Google Inc., OFL-1.1. 원문 고지 포함; 시스템 fallback 가능 |
| 사용자 업로드 | 사용자 선택 PNG / GLB | 사용자가 사용 권한을 확보해야 함. 자동 온라인 업로드 없음 |

## 설계와 참고 내용의 연결

| 기능 | 참고 / 공개 규격 여부 | 자체 설계 |
|---|---|---|
| 모델 가져오기 | SRC-002, SRC-006 / glTF 2.0 | 컨테이너·자원·UV 검사를 선행하고 GLTFLoader로 렌더용 객체 생성 |
| 텍스처 편집 | SRC-006 / Canvas API·glTF UV | 독립 레이어 문서 → 부위별 Canvas → CanvasTexture → PBR 재질 |
| PNG 입출력 | SRC-004 / PNG | signature·IHDR·용량 검사와 브라우저 이미지 디코딩, 렌더 캔버스 출력 |
| SVG 제한 | SRC-003 / SVG 2 | 안전한 subset 처리기가 준비되지 않아 가져오기 미지원. 위험 SVG 시험 자료만 보관 |
| 프로젝트 | ZIP 및 JSON의 공개 구조 | STULOOMA 자체 버전 1 매니페스트, 원본 에셋과 편집 가능한 레이어 저장 |
| 데스크톱 | SRC-005 / Electron API | 제한된 preload bridge, main 파일 대화상자·안전 저장, 외부 탐색 차단 |
| 반응형 화면 | SRC-007, SRC-008 / React·Three.js API | Zustand 문서 상태와 명령/히스토리 기반 UI 동기화 |

## 범용 라이브러리

아래 라이선스는 설치된 `node_modules/<package>/package.json`의 `license` 필드에서 확인했다. 전체 의존성과 법적 고지는 [LICENSES.md](LICENSES.md)를 참조한다.

| 라이브러리 | 용도 | 확인한 라이선스 |
|---|---|---|
| React / React DOM | UI | MIT |
| Three.js | 메시·UV·렌더링·GLB | MIT |
| React Three Fiber / Drei | React 3D 통합·카메라 | MIT |
| Zustand | 상태·히스토리 | MIT |
| fflate | 프로젝트 ZIP | MIT |
| Electron / Electron Forge | 데스크톱 셸·패키징 | MIT |
| Lucide React | 범용 아이콘 | ISC |
| Noto Sans KR Variable / Fontsource 패키지 | 로컬 한글 글꼴 | OFL-1.1 |
| Vite / Vitest | 빌드·테스트 | MIT |
| Playwright | 실제 UI·Electron 검증 | Apache-2.0 |

금지한 경쟁 소프트웨어 구현 소스·비공개 API·디컴파일·고유 모델/아이콘을 조사 자료로 사용하지 않았다. 공개 문서와 설치된 범용 라이브러리를 읽고 API를 사용했다. 사용자 파일 또는 신규 에셋을 추가할 때 출처·권리·수정 여부를 이 기록과 라이선스 목록에 추가한다.

## 기술·출시 한계

정적 의류 목업은 봉제·드레이핑·핏 시뮬레이션이 아니다. UV 디자인 좌표는 실제 생산 치수나 재단 패턴이 아니다. 화면 색상과 실제 원단·인쇄의 일치를 보증하지 않는다. 프로젝트 자체 코드는 현재 `UNLICENSED`이며 상용 배포 전 배포권, 의존성 고지, 상표·앱 식별자·확장자 충돌, 코드 서명과 OS별 실행을 검토해야 한다.

2026-10-18 최종 보정: 자체 어깨 메시의 BACK UV를 상단 영역으로 연결하여 로고 반복을 제거했다. 범용 라이브러리의 실제 번들 목록과 청크 해시는 `bundle-audit.json`, 추가 확보한 공식 라이선스 원문은 `third-party/supplemental.json`에 기록했다. 기존 상용 애플리케이션의 구현이나 에셋은 사용하지 않았다.

## 0.2.0 인터페이스 패치

사용자의 전문 디자인 도구 수준 편의성 요청에 따라 범용 메뉴·키보드 명령·패널 조절·정렬·캔버스 탐색을 독립 구현했다. 경쟁 제품의 소스·그래픽·비공개 문서·고유 화면을 가져오지 않았다. 기존 라이브러리와 로컬 Noto 글꼴만 사용했다. Superdesign 저장소 분석/디자인 문맥을 준비했지만 계정 인증이 없어 외부 디자인 생성은 수행하지 않았다.
