# 검증 계획과 실행 기록

갱신일: 2026-10-18. 0.2.0 작업 공간 패치 검증 항목을 포함한다. **계획 항목은 통과 결과가 아니다.** 구현·실행 환경·실제 출력으로 확인된 결과만 기록한다. P0 완료 판정에는 단위 검사뿐 아니라 실제 UI, 프로젝트 round-trip, PNG 결과, 데스크톱 실행이 필요하다.

## 요구사항 추적

| 테스트 ID | 범위 / 인수 조건 | 관련 명세 | 방법 |
|---|---|---|---|
| TEST-MODEL-001 | 두 실제 모델의 position/normal/index·치수·뒤판·열린 목/소매 형상 | SPEC-001 | Geometry 검사 + 360° UI 확인 |
| TEST-MODEL-002 | 부위 UV 유효 범위·법선·index·앞뒤 방향 | SPEC-005,012 | 숫자 검사 + 비대칭 체크 무늬 시각 확인 |
| TEST-IMPORT-001 | 정상 투명 PNG, 거짓 MIME/헤더, 손상·초과 픽셀 거부 | SPEC-003 | 단위 + 업로드 UI |
| TEST-IMPORT-002 | 자체 포함 GLB·UV 없음·손상·외부 URI·지원 밖 확장 | SPEC-011,012 | 검사 함수 단위 + 사용자 등록 UI |
| TEST-HISTORY-001 | 다단계 Undo/Redo·삭제/복제·reorder·새 편집 후 future 삭제·drag 그룹 | SPEC-004,007,102 | Zustand 상태 단위 + 2D UI |
| TEST-PROJECT-001 | 한글 이름·원본 이미지·사용자 GLB 바이트·레이어 transform·앞뒤 색·재질·카메라·선택 metadata 저장 복원 | SPEC-002,006,008,009,101,103 | `.stulooma` round-trip |
| TEST-PROJECT-002 | 로컬 자동 저장·복구·손상 복구 실패 시 격리 | SPEC-105 | 브라우저 IndexedDB 통합 |
| TEST-SECURITY-001 | ZIP 경로 순회·중복·손상·팽창 한도·미래 버전·잘못된 참조 | SPEC-009,014 | 비신뢰 fixture 단위 |
| TEST-UI-001 | 앱 로드·새 반팔·새 농구·실제 WebGL 캔버스 | SPEC-001 | Playwright 실제 브라우저 |
| TEST-UI-002 | 앞뒤/좌우·회전·확대·카메라 저장 | SPEC-002 | Playwright + 저장 문서 확인 |
| TEST-UI-003 | PNG 업로드→원본 asset·선택 레이어·3D 합성 | SPEC-003 | Playwright |
| TEST-UI-004 | 이동·크기·각도·레이어 순서·lock/visible | SPEC-004,102 | Playwright |
| TEST-UI-005 | 로고가 앞뒤 독립·회전 중 표면에 부착 | SPEC-005 | 시각 확인; 단순 canvas 존재만으로 대체하지 않음 |
| TEST-UI-006 | 앞뒤 색상·재질 독립·복원 | SPEC-006 | Playwright + 문서 |
| TEST-UI-007 | 실제 3D PNG/JPG, 요청 해상도·알파·비어 있지 않은 픽셀 | SPEC-010 | 이미지 디코딩 + 실제 출력 확인 |
| TEST-UI-008 | GLB 업로드·mesh 영역 지정·사용자 등록·재열기 | SPEC-011 | Playwright |
| TEST-UI-009 | 한글 프로젝트/선수명·IME composition·입력 중 단축키 차단 | SPEC-015,101 | Playwright + 실제 OS IME 수동 확인 |
| TEST-UI-010 | 미저장 변경 확인·파일 열기 취소·손상 시 기존 디자인 유지 | SPEC-009 | Playwright |
| TEST-EXPORT-001 | GLB binary 출력과 GLTFLoader 재로드·재질/UV/텍스처 유지 | SPEC-104 | 통합 + 브라우저 출력 |
| TEST-DESKTOP-001 | Electron 실행·preload 제한 API·실제 저장/열기 | SPEC-013 | Electron Playwright·Linux 패키지 실행 |
| TEST-DESKTOP-002 | 격리 설정·외부 탐색·IPC 발신자/인자·경로 검증 | SPEC-014 | 보안 단위 + Electron 검사 |
| TEST-DESKTOP-003 | 첫 저장·토큰 반복 저장·Save As·취소 후 대상 유지·새 문서 권한 분리·알 수 없는 토큰·중복 저장 거부 | COMMANDS 저장 경계 | 실제 Electron bridge·파일 내용·대화상자 호출 수 |
| TEST-WORKSPACE-001 | 명령 검색·비일치 결과·초점 복귀·메뉴 키 탐색·입력/IME에서 디자인 명령 차단 | UI_SPEC 메뉴·키보드 | workspace E2E, 실제 OS IME는 별도 수동 |
| TEST-WORKSPACE-002 | PNG 앱 내부 복사·다른 부위 붙여넣기·원본 보존·Undo/Redo·한글 이름·잠금 transform 보호 | COMMANDS 클립보드·잠금 | store 단위 + workspace E2E |
| TEST-WORKSPACE-003 | 회전 경계 정렬·0.1%/1% nudge·2D 확대/맞춤·그리드·스냅·실제 드래그와 Undo | UI_SPEC 2D | store 단위 + workspace E2E |
| TEST-WORKSPACE-004 | 1366×768 필수 버튼 접근·가로/세로 넘침·패널 드래그·표시/너비 재시작 보존 | UI_SPEC 작업 공간 | 실제 레이아웃 치수·reload·스크린샷 |
| TEST-WORKSPACE-005 | 기록 스냅샷 이동·새 편집의 Redo 제거·저장 내용으로 Undo 시 clean·잠금/no-op 기록 보호 | COMMANDS history | store 단위 + 실제 기록 패널 인수 확인 |
| TEST-WORKSPACE-006 | PNG/GLB/project 한 개 드롭·다중/미지원/손상 거부·기존 문서 보존 | UI_SPEC 파일 놓기 | 실제 File/DataTransfer 드롭 인수 확인 |
| TEST-WORKSPACE-007 | 캔버스 pan/zoom 표시만 변경·Alt 스냅 해제·15° 회전·포인터 취소/blur 그룹 종료 | UI_SPEC 2D | 캔버스 포인터·키보드 인수 확인 |

## 실제 테스트 파일 연결

| 파일 | 인수 범주 |
|---|---|
| `tests/unit/garments.test.ts` | TEST-MODEL-001/002, 기본 GLB 재로드 |
| `tests/unit/glb.test.ts` | TEST-IMPORT-002, GLB 자원·구조·UV 제한 |
| `tests/unit/project.test.ts` | TEST-PROJECT-001, 별도 History 자료구조 |
| `tests/unit/studio.test.ts` | TEST-HISTORY-001, 실제 UI command store·저장 race·no-op·lock·회전 정렬·부위별 순서·클립보드·saved-content dirty |
| `tests/security/project-security.test.ts` | TEST-SECURITY-001, TEST-IMPORT-001 |
| `tests/e2e/studio.spec.ts` | 실제 반팔/농구 편집·카메라·PNG 2048·GLB·저장/열기·사용자 라이브러리·잘못된 파일 |
| `tests/e2e/workspace.spec.ts` | TEST-WORKSPACE-001/002/003/004: 명령/메뉴·입력/IME guard·클립보드·이름/잠금·2D 정렬/확대/스냅·1366px 패널 보존 |
| `tests/e2e/autosave.spec.ts` | TEST-PROJECT-002, 실제 IndexedDB 복구 및 원본·한글 디자인 보존 |
| `tests/electron/desktop.spec.ts` | TEST-DESKTOP-001/002/003, native bridge·승인 토큰 저장/Save As/취소·파일 I/O·동시 작업/잘못된 토큰·네트워크/외부창 제한 |

TEST-WORKSPACE-005의 실제 기록 패널 이동, TEST-WORKSPACE-006의 PNG File/DataTransfer 드롭과 원본 바이트, TEST-WORKSPACE-007의 Space 팬/맞춤은 workspace.spec.ts의 추가 인수 테스트로 확인한다. GLB/project 드롭·다중 드롭 거부, Alt 스냅 해제·15° 회전·포인터 취소의 모든 조합은 별도 인수 범위로 남긴다. 테스트 ID는 범주이며 자동 테스트 개수와 같지 않다.

실제 OS IME는 자동 문자열 삽입만으로 검증되지 않는다. 3D 캔버스 존재·PNG의 불투명 픽셀 수 검사는 정확한 UV 모양과 모든 회전 시각 검토를 대신하지 않는다.

## 실행 명령

```sh
npm ci
npm run generate:assets
npm run typecheck
npm test
npm run test:e2e
npm run test:desktop
npm run build
npm run package:linux
npm run package:win
```

GUI 테스트에는 Chromium/Electron 실행에 필요한 OS 라이브러리와 display 또는 Xvfb가 필요하다. 브라우저 설정은 기본 `/usr/bin/chromium` 또는 `STULOOMA_CHROMIUM` 경로를 사용한다. 이 E2E의 Chromium launch에는 시험용 `--no-sandbox`와 SwiftShader를 사용하며 배포 앱의 기본 실행 설정과 구분한다. GPU가 없는 Linux에서는 소프트웨어 WebGL을 사용할 수 있지만 실제 GPU 성능 또는 Windows 드라이버 검증으로 간주하지 않는다. OS sandbox를 끄는 옵션이 필요했던 경우 반드시 실행 기록에 한계를 명시한다.

## 실행 결과 기록

0.1.0 개발판의 기존 실행 결과와 진단 경과는 [RESULTS.md](RESULTS.md) 및 `docs/evidence/`의 역사적 기록이다. **0.2.0 작업 공간 패치의 테스트 수·통과 상태로 재사용하지 않는다.** 이번 패치는 단위·Chromium GUI·실제 Electron 저장/열기·빌드·패키지 검사를 다시 실행하고 해당 revision의 실제 로그를 연결한 뒤 결과를 기록한다. 0.2.0의 최종 결과는 고유 검사 91개(단위/보안79, Chromium9, Electron3) 통과이며 [실제 결과](RESULTS.md)의 새 버전 로그를 따른다. 같은 Electron 3개를 Linux 패키지에서도 재검사했다.

기존 핵심 인수 범위는 두 의류의 앞/뒤 PNG 편집, 2D 드래그/크기/회전, Undo/Redo, 카메라·색상·재질, 프로젝트 저장/재열기, 투명 PNG와 JPG 디코딩, GLB 출력/검사/사용자 모델 등록·재시작 보존, 사용자 모델 새 이미지의 저장 복원, 잘못된 파일 거부, IndexedDB 복구다. `filename.test.ts`는 한글·경로 문법·Windows 예약 이름 정규화를, `garments.test.ts`는 다중 메시 논리 부위 UV와 어깨의 중앙 로고 반복 방지를 검사한다. 이번 작업 공간 변경 후 이 기능을 회귀 확인한다.

새 인수 흐름은 메뉴/검색/문맥 메뉴 → 실제 편집 → Undo/Redo → 저장/재열기 → 출력이다. 캔버스 표시 설정과 패널 설정이 문서 transform을 바꾸지 않는지, 저장/검색 전에 입력 초안이 커밋되는지, 잠금·no-op·저장 대상 토큰이 올바른지 확인한다. CSP·글꼴·UV·선택 문제의 실패와 수정 후 실행은 실제 근거대로 분리한다. 단순 canvas 존재·포트 열림·스크린샷만으로 데이터 보존과 실제 출력을 대신하지 않는다.

Linux Electron 시험은 Xvfb와 시험 전용 `STULOOMA_CI_NO_SANDBOX=1`을 사용할 수 있다. 이 경우 실제 OS 프로세스 sandbox 작동 검증으로 간주하지 않는다. Windows/macOS 네이티브 실행·실제 OS IME·서명/공증·실물 색상·성능 측정은 별도 검증이며 [GAPS.md](GAPS.md)를 따른다. 한국어 문자열·글꼴·synthetic composition guard 검사는 OS IME를 직접 조작한 검사가 아니다. 모든 목표 플랫폼까지 완성된 상용 P0 릴리스로 선언하지 않는다.
