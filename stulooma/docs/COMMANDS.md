# 명령 계약

메뉴·툴바·단축키·검색·문맥 메뉴는 `App`의 애플리케이션 명령 dispatcher를 공유한다. `StudioCommand` 목록은 이름·그룹·키 힌트·활성/체크 상태·검색 키워드를 제공한다. 문서 변경은 `src/state/studio.ts`의 typed `EditCommand`로 이어진다. 파일 선택·내보내기·카메라·작업 공간 보기는 별도 부수 작업이다. 아래는 0.2.0 작업 공간 패치의 실제 연결 범위이며 검증 결과는 [TEST_PLAN.md](TEST_PLAN.md)와 [RESULTS.md](RESULTS.md)로 구분한다.

## 애플리케이션 명령

| ID | 인자 / 조건 | 결과·오류 | 문서 Undo | 검증 범주 |
|---|---|---|---|---|
| `project.new` | 미저장 교체 확인 | 기본 반팔 새 문서·history/선택/저장 대상 초기화; 취소 보존 | 아니오 | TEST-UI-001/010 |
| `project.open` | 사용자 선택 .stulooma | 검증 후 교체; 네이티브 열기면 승인 대상 토큰 연결; 취소/손상 보존 | 아니오 | TEST-PROJECT-001, TEST-UI-010 |
| `project.save` | 현재 유효 문서 | Electron: 승인 토큰 있으면 같은 파일에 저장, 없으면 대화상자. 웹: 다운로드 | 아니오 | TEST-DESKTOP-003 |
| `project.saveAs` | 현재 유효 문서 | Electron: 항상 다른 이름 대화상자, 성공 시 새 토큰. 웹: 다운로드 | 아니오 | TEST-DESKTOP-003 |
| `edit.undo`, `edit.redo` | 해당 history 존재 | 스냅샷 복원, 저장 상태 재계산; 없으면 무변경 | 서로의 역연산 | TEST-HISTORY-001 |
| `edit.copy` | 선택 레이어 | 원본 자원을 포함한 앱 내부 사본; 시스템 클립보드 사용 안 함 | 아니오 | TEST-WORKSPACE-002 |
| `edit.paste` | 앱 내부 사본 존재 | 현재 부위에 새 ID·오프셋·잠금 해제 사본; 원본 PNG 재사용/복원 | 예 | TEST-WORKSPACE-002 |
| `edit.duplicate` | 선택 레이어·레이어 수 한도 | 새 ID·3.5% 오프셋·잠금 해제 사본 | 예 | TEST-HISTORY-001 |
| `edit.rename` | 선택 레이어 | 이름 대화상자 → artwork.update; UI 120자, 빈 이름 미적용 | 예 | TEST-WORKSPACE-002 |
| `edit.delete` | 선택·잠금 해제 레이어 | artwork.delete; 원본 asset은 보존 | 예 | TEST-HISTORY-001 |
| `artwork.import` | PNG 파일 | 구조·디코딩 검사 후 asset와 image 레이어, 실패 시 문서 보존 | 예 | TEST-IMPORT-001, TEST-UI-003 |
| `artwork.addText` | 활성 부위 | 편집 가능한 text 레이어 추가 | 예 | TEST-UI-009 |
| `model.import` | GLB 파일 | 구조·UV 선검사 → 메시 부위 지정 → 사용자 라이브러리·새 문서 | 교체로 초기화 | TEST-IMPORT-002, TEST-UI-008 |
| `align.left/center/right/top/middle/bottom` | 선택·잠금 해제 레이어 | artwork.align; 회전 경계 기준 단위 캔버스 정렬 | 예 | TEST-WORKSPACE-003 |
| `workspace.split/3d/2d` | 없음 | 분할/3D/2D 화면, localStorage 보관 | 아니오 | TEST-WORKSPACE-004 |
| `workspace.library`, `workspace.inspector` | 없음 | 해당 패널 표시 전환 | 아니오 | TEST-WORKSPACE-004 |
| `workspace.panels` | 없음 | 하나라도 보이면 모두 숨김, 모두 숨겨져 있으면 모두 표시 | 아니오 | TEST-WORKSPACE-004 |
| `workspace.history` | 없음 | 속성 패널 표시 후 기록 탭 선택 | 아니오 | TEST-WORKSPACE-005 |
| `workspace.reset` | 없음 | 보기·너비·표시·분할 비율 기본값, 속성 탭 선택 | 아니오 | TEST-WORKSPACE-004 |
| `view.front/back/left/right/perspective` | 유효 뷰어 | 3D 시점·target, 문서 카메라에 보관 | 아니오 | TEST-UI-002 |
| `view.zoomIn`, `view.zoomOut` | 유효 뷰어 | 거리 ×0.85 / ×1.15 | 아니오 | TEST-UI-002 |
| `export.png` | 출력할 뷰어 | PNG 기본 내보내기 대화상자; 내부 PNG/JPG/GLB 선택 | 아니오 | TEST-UI-007, TEST-EXPORT-001 |
| `help.guide`, `help.commands` | 없음 | 사용 가이드 / 명령 검색 | 아니오 | TEST-WORKSPACE-001 |

슬래시 표기는 각 독립 ID를 축약한 것이다. `view.left/right/zoomIn/zoomOut`은 카메라 버튼에 연결되어 있으나 현재 메뉴·검색 목록에는 front/back/perspective만 들어간다. JPG/GLB는 실제 내보내기 대화상자 선택이며 별도 `export.jpg/glb` dispatcher ID는 없다. 비활성 명령과 파일 작업 진행 중 명령은 실행하지 않는다. 파일을 놓는 동작은 동일 import/load 검증 함수를 사용하지만 명령 검색 항목은 아니다.

## 문서 편집 명령: 실제 discriminated union

| ID | 인자 | 결과 / 조건 / 무변경 처리 | 검증 범주 |
|---|---|---|---|
| `project.rename` | name: string | 제어문자 제거·최대 120자, 공백뿐인 이름 무시 | TEST-HISTORY-001 |
| `artwork.add` | layer, asset? | 유효 부위·고유 레이어 ID·수 한도·PNG 참조 검사, 자원 복사 후 추가·선택 | TEST-HISTORY-001 |
| `artwork.update` | layerId, Partial<ArtworkLayer> | 이름·표시·잠금 및 유효 transform/문자/색·부위·PNG 참조. ID/type 변경 불가 | TEST-HISTORY-001, TEST-UI-004 |
| `artwork.delete` | layerId | 잠금 해제 레이어만 제거; 원본 자원 보존 | TEST-HISTORY-001 |
| `artwork.duplicate` | layerId | 원본 잠금과 무관하게 새 ID·잠금 해제 사본 | TEST-HISTORY-001 |
| `artwork.align` | layerId, left/center/right/top/middle/bottom | 회전된 경계 크기로 가장자리 정렬, 중심은 0.5; 잠금이면 무변경 | TEST-WORKSPACE-003 |
| `artwork.nudge` | layerId, dx, dy | 유한 이동량만 누적, x/y 범위 제한; 잠금이면 무변경 | TEST-WORKSPACE-003 |
| `layer.reorder` | layerId, direction: -1 또는 1 | 같은 부위의 인접 레이어만 교환; 경계·잠금 무변경 | TEST-HISTORY-001 |
| `material.update` | regionId, Partial<RegionDesign> | 존재하는 부위의 #RRGGBB, 거칠기/금속성 0–1 | TEST-PROJECT-001, TEST-UI-006 |
| `settings.update` | Partial<ProjectDocument.settings> | textureSize 1024/2048, 유효 배경색, transparent, simple/expert | TEST-PROJECT-001 |

모든 실제 문서 변경은 Undo/Redo 대상이다. 같은 값·없는 ID·잘못된 참조·허용되지 않은 입력은 새 history나 dirty를 만들지 않는다. transform 범위는 x/y -10–10, width/height 0.00001–20, 회전 ±36000°, opacity 0–1, text fontSize 0.001–1024이며 유한 값만 받는다. 직접 캔버스 조작은 더 좁은 작업 범위를 사용할 수 있다. 실제 생산 치수 단위가 아니다.

잠긴 레이어의 이름·표시·잠금 해제는 수정할 수 있다. 잠금 해제와 transform을 같은 patch로 보내도 잠긴 상태에서 시작한 transform은 적용하지 않는다. 텍스트·위치·크기·회전·불투명도·색·부위 이동·삭제·순서 변경은 잠금 해제 후 별도 명령이어야 한다. 복사·복제는 원본을 수정하지 않는다.

연속 드래그와 캔버스 방향키 반복은 beginGroup/endGroup으로 묶는다. 그룹 종료 시 내용이 실제로 변했을 때만 한 기록을 더한다. 일반 편집은 future를 지우고 과거 최대 100개를 보관한다. Undo는 진행 중 그룹을 먼저 끝낸다. 기록 패널의 이전 상태 선택은 여러 번 Undo하므로 동일한 dirty/선택 보존 규칙을 따른다. replace/newProject는 다른 문서 history를 넘기지 않는다. 선택은 해당 레이어 부위를 활성화하고, 부위 이동은 문서 변경이나 dirty를 만들지 않는다. 카메라는 문서에 보존되지만 편집 Undo 기록을 만들지 않는다.

## 클립보드·저장 경계

copyLayer는 레이어와 원본 asset을 독립 복사해 메모리에 보관한다. pasteLayer는 현재 부위에 새 ID로 추가하고 연속 붙여넣기마다 2.5%씩 오프셋한다. 같은 PNG 바이트가 현재 문서에 있으면 자원을 재사용한다. 문서 교체 후에도 앱 세션 내부 사본은 사용할 수 있지만 재시작 시 보존하지 않는다. 복사는 Undo 대상이 아니고 붙여넣기만 문서 명령이다.

네이티브 saveProject는 name/data/documentToken?/saveAs?를 받는다. documentToken은 main에서 현재 webContents에만 연결한 승인 경로의 불투명 UUID이며 renderer가 경로를 제공할 수 없다. 잘못된/다른 창 토큰은 거부한다. Save As 취소·실패는 기존 연결을 보존한다. 새 토큰은 완전한 원자적 쓰기 성공 후 생성한다. 프로젝트 최대 64MiB, 출력 최대 128MiB, 안전 파일명·확장자 검증과 임시 파일 fsync/rename을 유지한다. 토큰과 경로를 문서 JSON·localStorage에 영구 저장하지 않는다. 브라우저 저장은 다운로드 요청이다.

markSaved는 완료한 프로젝트 ID와 revision을 확인한다. 저장 중 추가 변경은 dirty이며 저장 내용으로 돌아오면 clean이다. 선택 부위·updatedAt만 달라진 경우는 저장 내용 차이로 보지 않는다. 저장 취소는 markSaved를 호출하지 않는다.

## 단축키 범위

전역 키 맵은 [UI_SPEC.md](UI_SPEC.md)의 표를 따른다. 메뉴/대화상자 열린 상태·IME 조합·keyCode229·이미 처리된 이벤트는 건너뛴다. 입력 요소는 기본 편집을 보존하고 저장/명령 검색만 Blur 커밋 후 실행한다. 캔버스 초점의 Space/G/S/+/-/Ctrl0 및 방향키는 Canvas 핸들러가 소유한다. 패널 separator·탭 탐색 방향키는 레이어 이동으로 전달하지 않는다.

## 미구현 명령

project.close/duplicate, 시스템 clipboard 연동, 다중 선택, group/ungroup, model.create/edit/save, SVG import, artwork.flip, material.setNormalMap, export.batch, 실제 제작용 패턴은 완료 명령으로 표시하지 않는다. 도구를 추가할 때 인자·조건·오류·Undo·검증 범위를 함께 기록한다.
