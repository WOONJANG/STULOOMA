# Vector Studio UI·조작 계약

기존 STULOOMA 상단 작업 공간에서 `Vector Studio`를 선택한다. 같은 프로젝트·의류·안전 저장·메뉴·명령 검색·Undo를 유지한다. 3D 목업을 함께 확인하면서 벡터 캔버스와 속성/레이어를 편집한다. 모델 편집 등 구현하지 않은 작업 공간은 작동하는 버튼으로 추가하지 않는다.

## 화면과 실제 작업

- 왼쪽/상단 도구: 선택, 직접선택, 펜, 선, 사각형, 둥근사각형, 타원, 다각형, 별, 문자, 손 도구. 실제 지원하는 도구만 노출한다.
- 중앙: 현재 아트보드와 앱이 생성한 SVG path, 일정한 화면 크기의 선택/앵커/핸들, zoom/pan. 원본 SVG 마크업을 삽입하지 않는다.
- 속성: 객체 이름·위치·크기·회전·칠/선/opacity, 선택 path의 실제 앵커/핸들, 문자, 아트보드, 그룹/Boolean/compound/clip.
- 레이어: scene 순서·계층과 선택 상태 일치, 숨김/잠금/이름/삭제·복제. 잠금·숨김은 hit test에 반영한다.
- 3D 의류 적용: 현재 문서·아트보드와 실제 region 연결, 기존 artwork transform 유지, 연결 해제 시 원본 vector를 삭제하지 않는다.
- 상태: 현재 도구·zoom·선택정보·오류/손실경고·저장 상태. 입력 오류는 설명하고 기존 문서를 보존한다.

## 도구 조작

펜은 클릭으로 anchor, drag로 cubic handles, 첫 점 클릭으로 닫기, Enter로 열린 path 종료, Escape로 미완성 작업 취소를 제공한다. 점·핸들 수정은 객체 로컬 좌표를 역변환해서 반영하고 화면 확대가 경로 좌표에 영향을 주지 않아야 한다. 한 drag는 한 Undo 기록이다. 직접선택의 앵커/핸들은 별도 hit target으로 구분한다.

일반 선택은 클릭·Shift 추가·드래그 영역 선택, 이동/크기/회전 또는 수치 입력으로 편집한다. 그룹·clip 내부 선택 지원 범위와 제한은 실제 구현에 맞춰 기록한다. Boolean은 닫힌 경로가 부족하면 비활성/설명하고 잘못된 입력에서 기존 형상을 잃지 않는다. 빼기 대상은 쌓임 순서를 명시한다.

SVG 가져오기는 허용 subset과 손실 경고를 보여준다. 악성/손상 입력에서 현재 프로젝트·선택·기존 3D를 보존한다. 내보내기는 실제 SVG/PNG와 기존 목업 PNG/JPG/GLB 흐름을 구분한다. SVG export 후에도 편집 데이터를 유지한다.

## 키보드·IME

| 범위 | 키 | 동작 |
|---|---|---|
| 공통 | Ctrl/⌘ S, Shift S, O, N | 기존 프로젝트 저장/다른이름/열기/새프로젝트 |
| 공통 | Ctrl/⌘ Z, Shift Z/Y | 기존 공통 Undo/Redo |
| 공통 | Ctrl/⌘ K | 기존 명령 검색 |
| Vector 편집 | V/A/P/M/L/T/H 등 | 실제 도구 선택; 기존3D와 충돌하지 않는 workspace 범위 |
| Vector 편집 | Ctrl/⌘ A/C/V/X/D/G | 전체선택·내부복사/붙이기/잘라내기/복제·그룹; 구현범위만 연결 |
| Vector 편집 | Delete/Escape/Enter | 선택삭제/취소·해제/펜종료 |
| Vector 탐색 | Space/중간버튼/휠 | 구현된 pan/zoom, 문서좌표불변 |

입력/textarea/select/contenteditable, IME isComposing/keyCode229, 이미 처리한 이벤트를 가로채지 않는다. 한글 `정관장`, `서울 삼성 썬더스`, `변준형`, `유니폼 디자인`, `STULOOMA`를 입력·저장한다. 자동시험의 Unicode insert와 실제 운영체제 IME 시험은 구분해 보고한다. 메뉴/버튼/키는 동일 editor command를 호출하고 프로젝트 저장키는 전역을 중복 실행하지 않는다.

## 검증

정확한 실제 accessible label·testid는 feature component와 [vector.spec.ts](../tests/e2e/vector.spec.ts)의 사용을 기준으로 갱신한다. 도구 버튼의 존재만으로 완료로 간주하지 않는다. 실제 path·선택·Undo·저장·3D·출력 결과가 달라져야 한다. 모바일/태블릿 최적화나 Adobe UI 복제를 범위에 포함하지 않는다.
