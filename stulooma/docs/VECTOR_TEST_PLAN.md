# Vector Studio 검사 계획·근거

기준 버전 0.2.0은 단위/보안 79 + Chromium 9 + Electron 3 = 고유 91개다. 0.3.0은 새 검사와 기존 회귀를 함께 실행한다. 과거 로그를 새 기능 통과로 재사용하지 않고, 반복 실행은 고유 검사 수에 다시 더하지 않는다. 미지원 미래 버전 거부 fixture는 이제 지원하는 프로젝트 v2 대신 v3을 검사한다.

## 인수 검사 매핑

| 검사 ID | 확인하는 동작 | 실제 근거·범위 |
|---|---|---|
| V-GEOM-01 | 선·도형·행렬·bounds·좌표 불변 | [geometry unit](../tests/unit/vector-geometry.test.ts), UI 확대 전후 path 동일 |
| V-GEOM-02 | cubic·quadratic·arc, 점 추가/삭제·열기/닫기·연결/분리/반전 | geometry unit, 펜 drag와 실제 앵커/핸들 UI |
| V-BOOLEAN-01 | union/difference/intersection/xor/divide, 곡선/구멍·빈 결과·퇴화 | geometry unit, 앞면 빼기 UI; 자기교차/과도한 복잡도는 원본 보존 후 거부 |
| V-COMPOUND-01 | evenodd/nonzero와 내부 알파 | geometry unit, 투명 PNG 픽셀 및 실제 글리프 윤곽선 |
| V-DOC-01/02 | 계층·부모 변환·선택 루트·다중 아트보드·잠긴 의류 배치 | [project unit](../tests/unit/vector-project.test.ts), SVG 그룹·render 픽셀; 전체 그룹/보드 UI 조합은 추가 QA |
| V-SVG-01 | 지원 요소·중첩 transform·gradient·clip·text·embedded PNG·arc | [SVG unit](../tests/unit/vector-svg.test.ts), 실제 파일 import |
| V-SVG-02 | 유효 XML·편집 경로·쓰기/읽기 | SVG unit, 브라우저 파일 다운로드 및 native SVG 저장 |
| V-SVG-SEC | script/on*·DOCTYPE/entity·외부 href/CSS·손상·순환·budget | SVG unit, 위험 파일 3종 UI 거부·문서 보존·외부 요청 없음 |
| V-CLIP-01 | clip 편집·해제·원본 보존·알파 | SVG/project unit, PNG clip 가져오기, 그룹 clip 생성/해제·아트보드 복제 UI와 실제 Canvas 픽셀 |
| V-GRADIENT-01 | 선형/방사형·stops·opacity·units·matrix | SVG 왕복, 실제 PNG 및 Canvas 픽셀 |
| V-TEXT-01 | 한국어·영어·숫자·자간·대체 font·입력키 보호 | vector UI Unicode/필드 내 Ctrl+A; OS IME와 Vector 조합 이벤트의 전체 실기 과정은 미검증 |
| V-TEXT-02 | 실제 글리프 path·OAB 구멍·한글·저장 | [text unit](../tests/unit/vector-render.test.ts), UI 윤곽선/Undo, text와 outline의 Canvas 픽셀 동일 |
| V-HISTORY-01 | 한 drag 한 기록, 객체/앵커/문자/바인딩 Undo/Redo | 기존 store와 project unit, 실제 앵커·핸들·문자 윤곽선 UI; 모든 2D/3D 연속 프레임 비교는 미실행 |
| V-PROJECT-01 | 기존 v1 → 벡터 v2 → 저장/열기 → 재편집 | project/store unit, 브라우저·Electron 실제 파일 흐름 |
| V-PROJECT-02 | 원본 PNG/GLB 바이트·기존 레이어 보존 | ZIP 엔트리/복원 바이트 비교, 실제 UI PNG 및 Electron v1 샘플 보존 |
| V-PROJECT-03 | 잘못된 문서/참조/순환/수치/버전·저장 크기 | project/security unit; 2 MiB UTF-8 manifest 초과는 편집 반영 전 거부 |
| V-3D-01 | 앞판 적용·배치 변경·실시간 갱신 | 실제 WebGL 화면 변경 및 저장 binding 확인; 벡터 뒷판/소매 실기 QA 별도 |
| V-3D-02 | 구멍·gradient·clip·혼합 레이어 순서·캐시 | [render browser](../tests/e2e/vector-render.spec.ts)의 실제 Canvas 픽셀, [vector UI](../tests/e2e/vector.spec.ts) 실제 3D 갱신 |
| V-UI-01/02/03 | 같은 workspace·실제 도구·선택·수치·공통 키 | vector UI 6개; 전체 선택/레이어/아트보드 조합을 모두 시험한 것은 아님 |
| V-NATIVE-01 | native v1 열기/v2 저장/재열기/SVG 출력·로컬 OTF | [desktop.spec.ts](../tests/electron/desktop.spec.ts) 네 번째 검사; 승인 token과 원본 에셋 보존 |
| V-REGRESSION | 기존 의류·Orbit·PNG·저장·재열기·목업·GLB·복구 | 단위/보안 전체 통과, 통합 Electron 전체 통과; 최종 브라우저 전체 실행 결과 별도 |

## 실행 명령

```sh
npm run typecheck
npm test
npm run test:e2e -- tests/e2e/vector.spec.ts
npm run test:e2e -- tests/e2e/vector-render.spec.ts
npm run test:e2e
npm run build
bash scripts/setup-cloud-display.sh --start
source /workspace/.cache/system/display.env
STULOOMA_CI_NO_SANDBOX=1 npm run test:desktop
```

Electron은 클라우드 Xvfb 환경에서 기존 scripts/setup-cloud-display.sh를 사용한다. 브라우저는 실제 Chromium/WebGL(SwiftShader)이다. 원격 Windows ZIP 생성은 Windows에서 GUI를 실행했다는 뜻이 아니다. 패키지 CRC·버전·main/preload/renderer hash·라이선스·다운로드 checksum도 최종 배포에서 확인한다.

## 결과 기록

2026-10-18, 0.3.0 통합 시점의 실제 결과다. 최종 검사·패키지 로그는 `docs/evidence/vector-0.3.0/`에 보관하고 최종 합계는 [VECTOR_RESULTS.md](VECTOR_RESULTS.md)에서 확정한다.

| 실행 | 확인된 결과 | 범위/후속 |
|---|---|---|
| typecheck + production build | 통과 | renderer와 Electron main/preload 생성 |
| 단위/보안 전체 | 147개 통과, 10개 파일 | 새 벡터 및 기존 프로젝트·보안·상태·의류 회귀 포함 |
| 벡터 UI 집중 실행 | 6개 통과, 53.7초 | 실제 앱·WebGL·파일·윤곽선·오류 처리 |
| 브라우저 렌더 집중 실행 | 4개 통과 | 실제 픽셀·혼합 합성·캐시·한글 윤곽선 동등성 |
| 통합 Electron 전체 | 4개 통과, 50.8초 | bridge·native 파일·저장 대상·벡터·OTF |
| 최종 전체 Chromium | 24개 통과 | 잠금·이어그리기·마스크복사 3개, 그룹·클립·아트보드·뒷판 1개 포함; 집중 실행과 중복 합산 금지 |
| 최종 빌드 Electron 재검사·패키지 실행 | 각 4개 통과 | 최종 production 빌드 및 Linux 패키지 실제 실행; 같은 검사이므로 고유 수 중복 합산 금지 |
| Linux/Windows ZIP·checksum | 통과 | CRC·버전·137개 코드/글꼴 파일·notices·app.asar 해시 비교; Windows GUI 성공과 구분 |

Electron 첫 시도는 종료된 Xvfb 때문에 앱이 뜨기 전에 실패했다. 기존 display helper로 Xvfb를 다시 시작한 뒤 코드 수정 없이 4개가 통과했다. 이는 클라우드 표시 서버의 상태 문제였으며 기능 오류를 숨기기 위한 검증 생략은 없다. CI의 `STULOOMA_CI_NO_SANDBOX=1`은 이 환경의 실행 옵션이며 배포 앱에 sandbox 해제를 넣지 않는다.

실제 OS 한국어 IME·Windows/macOS GUI·복잡 SVG 전체 호환성·상용 인쇄/ICC·성능 수치는 미검증이다. [미구현과 제약](VECTOR_GAPS.md)을 검사 누락으로 숨기지 않는다.

최종 고유 자동 검사 175개가 통과했다. 새 UI 회귀는 `vector-regression.spec.ts`(3개), `vector-workflow.spec.ts`(1개)다. 전체/production/native-packaged 로그와 무결성은 [VECTOR_RESULTS.md](VECTOR_RESULTS.md)의 증거를 따른다.
