# Vector Studio 기능 명세

기존 프로젝트에서 벡터 로고를 만들고, 앵커·곡선·도형 경계를 편집하고, 의류 UV에 적용한 뒤 편집 가능한 상태로 저장·재열기 하는 통합 흐름이다. 0.3.0에서 단위/보안 147개, 전체 Chromium 24개, Electron 4개가 통과했고 Linux 패키지에서 같은 Electron 4개를 다시 통과했다. 아래의 “검증”은 해당 자동검사 범위이며 모든 도구 조합·운영체제·상용 호환성 인증을 뜻하지 않는다. 전체 결과·로그·패키지 무결성은 [VECTOR_RESULTS.md](VECTOR_RESULTS.md)에 기록한다.

| ID | 기능 / 설명 | 우선순위 | 입력 → 출력 | 완료 기준 | 검사 ID | 상태 |
|---|---|---|---|---|---|---|
| V-01 | 기존 문서·3D·UV 보존 감사 | P0 | 기존 코드/샘플 → 통합 감사 | 기존 모듈·위험·회귀 명시, reset 없음 | V-REGRESSION | 감사·기존 단위·브라우저·Electron 회귀 통과 |
| V-02 | 동일 프로젝트 Vector Studio | P0 | 작업 공간 선택 → 편집 화면 | 별도 데모/창 없이 저장·history 공유 | V-UI-01 | 실제 UI·native 저장 검증 |
| V-03 | 아트보드·좌표 | P0 | 크기/단위 → artboard | zoom으로 좌표 불변, 크기 저장 | V-GEOM-01, V-PROJECT-01 | 좌표·확대·저장 검증; 단위는 표시 메타데이터 |
| V-04 | 객체 선택·다중선택 | P0 | 클릭/영역/Shift → selected IDs | 겹침·숨김·잠금·그룹 일치 | V-UI-02 | 클릭·전체·Shift·직접선택·상위그룹/경로 잠금 검증; 영역 조합 추가 QA |
| V-05 | 펜·직접선택 | P0 | 클릭/drag/anchor/handle → editable cubic path | 열린/닫힌 곡선·점/핸들 실제 편집 | V-GEOM-02, V-UI-02 | 실제 펜·앵커·핸들·점 추가·Undo 검증 |
| V-06 | 도형·변형 | P0 | 도구/수치 → path/matrix | 사각/원/선 등 실제 경로, 이동·크기·회전 | V-GEOM-01, V-UI-02 | 기하 검증, 사각/타원 UI·의류 배치 검증; 전체 도구 조합 추가 QA |
| V-07 | 칠·선·opacity | P0 | 색/없음/두께 → paint/stroke | 화면·SVG·3D·재열기 동일 | V-RENDER-01, V-SVG-02 | 칠·선 저장, 그룹/개체 알파·3D 갱신 검증 |
| V-08 | 그룹·레이어 | P0 | 선택/표시/잠금/순서 → scene graph | 자식 transform·페인트순서·잠금 보호 | V-DOC-01, V-UI-02 | 계층·변환·합성·그룹/잠금 UI 검증; 전체 레이어 조합 추가 QA |
| V-09 | 경로 Boolean | P0 | 닫힌 path 여러 개 → 실제 새경계 path | union/difference/intersection/xor/divide, 근사오차 명시 | V-BOOLEAN-01 | 실제 경계/구멍·거부 조건 unit, 앞면 빼기 UI 검증 |
| V-10 | 복합 패스 | P0 | 여러 윤곽 → compound | O/A/B 구멍이 투명; evenodd/nonzero | V-COMPOUND-01, V-RENDER-01 | 경로·문자 구멍과 PNG 알파 검증 |
| V-11 | SVG import | P0 | 비신뢰 SVG → editable 문서+경고 | 지원요소 편집·변환, 위험원본 실행 안 함 | V-SVG-01, V-SVG-SEC | 지원 subset·위험 입력 unit/UI 검증 |
| V-12 | SVG export | P0 | 문서/아트보드 → 유효 XML | path/칠/선/구멍 roundtrip; 래스터 대체 금지 | V-SVG-02 | XML·편집 경로·브라우저/native 파일 출력 검증 |
| V-13 | 공통 Undo/Redo | P0 | vector edit/drag → history | 한 drag 한 기록; vector·binding 상태 같이 복원 | V-HISTORY-01 | 공통 store·드래그·앵커·문자 윤곽선 Undo 검증 |
| V-14 | 프로젝트 저장 통합 | P0 | 기존 v1+vector → v2 ZIP → 복원 | 원본 PNG/GLB·기존 레이어·새 경로 모두 보존 | V-PROJECT-01/02/03 | unit·브라우저·native 저장/재열기 통과 |
| V-15 | 3D 의류 적용·재편집 | P0 | doc/artboard/region → vector artwork layer | 실제 UV·alpha·합성순서·실시간반영·위치유지 | V-3D-01/02 | 앞판/뒷판 실시간·배치·재연결·혼합순서 검증; 소매 벡터 실기 QA 남음 |
| V-16 | 클리핑 | P1 | 객체+path → clip ref | 실제 클립, 해제 후 원본 보존 | V-CLIP-01 | 가져오기·생성/해제·변환·복제·원본 PNG 보존 UI 검증 |
| V-17 | 선형·방사형 gradient | P1 | stops/좌표 → paint | SVG·Canvas·재열기 지원범위 일치 | V-GRADIENT-01 | 선형 PNG·방사형/변환 Canvas 픽셀·SVG 왕복 검증 |
| V-18 | 한글·영문 text | P1 | IME/string/spacing → text object | 입력키 보존·font 경고·편집가능 | V-TEXT-01, V-UI-03 | 한글/영문 입력·로컬 편집키·저장 검증; OS IME 미검증 |
| V-19 | 실제 문자 윤곽선 | P1 | 권리확인 font text → glyph paths | cubic/compound, 내부구멍, PNG 대체 금지 | V-TEXT-02 | Noto Regular 400 한정 실제 글리프·한글·동일 픽셀·Undo 검증 |
| V-20 | 정밀정렬·다중아트보드 | P1 | 수치/boards → 문서 | 수치저장·이동·크기·삭제제약 실제작동 | V-DOC-02 | 다중 보드 저장/삭제 unit, 복제 시 계층/clip/mask/변환 UI 검증; 전체 조합 추가 QA |
| V-21 | 획확장·패스위문자·PDF | P1 | 전문출력/문자 → 새경로/문서 | 실제기하/폰트/페이지검사 후에만 완료 | 미실행 | 미구현 범위는 GAPS |
| V-22 | Trace/Offset/자동화 | P2 | 이미지/경로/반복데이터 | 실제알고리즘 후에만 사용가능 | 미실행 | 후속 범위 |
| V-23 | CMYK/ICC/생산데이터 | P3 | profile/제작조건 | 실물검증과 색상관리 필요 | 미실행 | 후속 범위 |

**판정 범위:** 벡터 생성·편집·의류 적용·저장/재열기의 핵심 인수 흐름은 통과했다. 전체 기존 브라우저 회귀와 최종 패키지 검사를 통과했으며 추가 QA 범위는 위에 구분해 기록한다. 모든 P0 요구 조합이나 전문 상용 벡터 제품의 전체 기능을 검증했다고 선언하지 않는다. 실제 테스트 파일과 결과는 [VECTOR_TEST_PLAN.md](VECTOR_TEST_PLAN.md), 미구현·제한은 [VECTOR_GAPS.md](VECTOR_GAPS.md)를 따른다.
