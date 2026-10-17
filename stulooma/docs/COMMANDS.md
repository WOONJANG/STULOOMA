# 명령 계약

애플리케이션 명령은 메뉴·툴바·단축키가 공유한다. 문서를 수정하는 명령은 `src/state/studio.ts`의 typed `EditCommand`로 이어진다. 파일 선택·내보내기·카메라는 별도 부수 작업이므로 편집 히스토리에 무조건 넣지 않는다. 아래는 0.1.0의 연결 범위이며 테스트 통과 여부는 [TEST_PLAN.md](TEST_PLAN.md)를 따른다.

## 애플리케이션 명령

| ID | 인자 / 실행 조건 | 결과·오류 | Undo / Redo | 테스트 |
|---|---|---|---|---|
| `project.new` | 선택 garment; 미저장 문서 확인 | 새 문서·history 초기화; 취소 시 보존 | 아니오 | TEST-UI-001 |
| `project.open` | 사용자 선택 `.stulooma` | 검증 후 교체; 취소/손상 시 기존 문서 유지 | 아니오 | TEST-PROJECT-001, TEST-UI-010 |
| `project.save`, `project.saveAs` | 현재 유효 문서 | ZIP 저장; 취소·실패·저장 중 새 변경 구분 | 아니오 | TEST-PROJECT-001, TEST-DESKTOP-001 |
| `edit.undo`, `edit.redo` | 해당 history 존재 | 문서 스냅샷 복원; 빈 history는 변화 없음 | 서로의 역연산 | TEST-HISTORY-001 |
| `edit.delete`, `edit.duplicate` | 선택 레이어 | `artwork.delete/duplicate`; 미선택 시 변화 없음 | 예 / 예 | TEST-HISTORY-001 |
| `artwork.import` | PNG 사용자 파일 | 검증·디코딩 뒤 asset와 image 레이어; 실패 시 상태 유지 | 예 / 예 | TEST-IMPORT-001, TEST-UI-003 |
| `artwork.addText` | 활성 부위 | text 레이어 추가 | 예 / 예 | TEST-UI-009 |
| `model.import` | 사용자 GLB | 선검사·mesh 영역 지정 후 사용자 의류; UV/형식 오류 | 문서 교체로 history 초기화 | TEST-IMPORT-002, TEST-UI-008 |
| `view.front/back/left/right/perspective` | 현재 모델 | 카메라 위치/target; 문서에 보존 | 아니오 | TEST-UI-002 |
| `view.zoomIn`, `view.zoomOut` | 유효 카메라 | 거리 조정 | 아니오 | TEST-UI-002 |
| `export.png` | 준비된 뷰어 | 기본 PNG 출력 대화상자 열기. 내부에서 PNG/JPG/GLB 형식 선택·저장; GPU·저장 오류 표시 | 아니오 | TEST-UI-007, TEST-EXPORT-001 |

JPG/GLB 출력은 실제 내보내기 대화상자의 형식 선택이다. `export.jpg`/`export.glb`를 연결된 dispatcher ID로 표시하지 않는다.

슬래시로 축약한 카메라 행은 각각 독립 ID(`view.front`, `view.back`, `view.left`, `view.right`, `view.perspective`)다. 사용자 요구의 `artwork.move/scale/rotate`는 별도 중복 reducer 대신 `artwork.update`의 patch로 통합했다. `garment.setColor`와 `material.setColor/setRoughness`도 `material.update`를 공유한다.

## 문서 편집 명령: 실제 discriminated union

| ID | 인자 타입 | 결과 / 조건 / 오류 처리 | Undo / Redo | 테스트 |
|---|---|---|---|---|
| `project.rename` | `{name: string}` | 제목 최대 120자; 한국어 유지 | 예 / 예 | TEST-HISTORY-001, TEST-UI-009 |
| `artwork.add` | `{layer: ArtworkLayer, asset?: AssetRecord}` | 원본 보존·레이어 추가·선택 | 예 / 예 | TEST-HISTORY-001 |
| `artwork.update` | `{layerId: string, patch: Partial<ArtworkLayer>}` | 위치/크기/회전/문자/표시/잠금 갱신; 없는 ID는 무변경 | 예 / 예 | TEST-HISTORY-001, TEST-UI-004 |
| `artwork.delete` | `{layerId: string}` | 레이어 제거, 원본 asset은 보존 | 예 / 예 | TEST-HISTORY-001 |
| `artwork.duplicate` | `{layerId: string}` | 새 ID·오프셋을 가진 사본; 없는 ID는 무변경 | 예 / 예 | TEST-HISTORY-001 |
| `layer.reorder` | `{layerId: string, direction: -1 | 1}` | 인접 레이어 교환; 경계 밖 무변경 | 예 / 예 | TEST-HISTORY-001 |
| `material.update` | `{regionId: string, patch: Partial<RegionDesign>}` | 선택 부위 color/roughness/metalness; UI는 존재하는 부위만 전달 | 예 / 예 | TEST-PROJECT-001, TEST-UI-006 |
| `settings.update` | `{patch: Partial<ProjectDocument['settings']>}` | textureSize/background/transparent/mode | 예 / 예 | TEST-PROJECT-001 |

연속 이동 시작 시 `beginGroup`, 완료 시 `endGroup`을 호출해 한 번의 Undo로 되돌린다. 일반 편집은 future를 지우고 과거 100개를 유지한다. `replace/newProject`는 다른 프로젝트의 편집 기록을 넘기지 않는다. 선택·카메라 setter는 순수 편집 명령과 별도다.

## 미구현 명령

`project.close/duplicate`, clipboard copy/paste, group/ungroup, model.create/edit/save, SVG import, artwork.flip, material.setNormalMap, export.batch 및 실제 제작용 패턴 명령은 완료한 명령으로 표시하지 않는다. 도구를 추가할 때 인자 검증·실행 조건·오류·Undo 범위·테스트 ID를 먼저 이 표에 추가한다.
