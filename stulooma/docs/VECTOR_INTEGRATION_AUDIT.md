# 기존 STULOOMA 통합 감사

기준 소스: `a32a674` — STULOOMA 0.2.0 작업 공간 패치. 기존 checkout을 보존했고 초기화·전체 재작성·worktree 생성 없이 0.3.0을 통합했다. 이전 릴리스와 Git commit이 복구 기준점이다. 기존 91개(단위/보안 79 + Chromium 9 + Electron 3) 기록과 새 검사를 구분하며, 아래 결과는 현재 코드를 실제 실행한 근거다.

| 기존 기능 | 관련 파일 | 조사한 현재 상태 | 신규 기능과의 관계·재사용 | 변경/위험 | 필요한 검사 |
|---|---|---|---|---|---|
| 앱 진입/작업 공간 | src/app/App.tsx, src/state/workspace.ts | React 단일 편집 앱; split/3d/2d, 패널·명령 검색 | 같은 프로젝트에 vector 모드 추가 | 기존 보기·저장 키 충돌 | V-UI-01, 기존 workspace.spec |
| Electron main/preload | electron/main/index.ts, electron/preload/index.ts, electron/ipc | sandbox/contextIsolation, 고정 bridge; 승인 저장 token | 기존 native file boundary 재사용 | SVG kind·로컬 OTF MIME 확장, bridge는 기존 3개 메서드 유지 | desktop.spec 4개 통합 통과 |
| 2D 디자인 | src/features/design-editor/DesignCanvas.tsx | 래스터/문자 선택·이동·크기·회전·팬·스냅 | 기존 artwork 배치와 vector 참조 레이어 공존 | vector를 text로 잘못 그리지 않게 분기 | V-3D-01, 기존 studio.spec |
| 3D 뷰어 | src/features/viewport/Viewer.tsx | 기존 R3F/Three 모델, 부위별 texture 갱신 | 뷰어·카메라·UV 그대로 사용 | 매 벡터 편집 시 모델 재로딩 금지 | V-3D-01/02, 기존 studio.spec |
| 의류/UV | src/core/garments/index.ts | 독립 반팔·농구, 앞뒤·소매 등 논리 region ID | vector layer.regionId로 같은 UV에 연결 | 좌표/UV 변경 없음; 사용자 GLB 영역 참조 확인 | 기존 garments/glb tests |
| Texture Composer | src/core/textures/composer.ts | 부위색→PNG/text를 배열 순서로 Canvas 합성 | vector artboard render를 기존 layer transform에 합성 | 알파/구멍/순서/방향 유지 | V-RENDER-01, V-3D-02 |
| 상태/명령 | src/state/studio.ts | typed EditCommand, 공통 dirty, 선택, clipboard | vector.document.set/remove/bind/unbind가 같은 execute/history 사용 | 별도 vector undo 없음, vector artwork 복사 시 문서/에셋 함께 보존 | V-HISTORY-01, vector-project 13개 |
| Undo/Redo | src/state/studio.ts, src/core/history/index.ts | 최대 100 snapshots, drag grouping, 새편집 redo제거 | 도형·앵커·색·바인딩 상태 같이 복원 | 3D·2D 동시 복원, no-op history 금지 | V-HISTORY-01, 기존 studio unit |
| 프로젝트 저장 | src/core/project/index.ts, src/core/validation/project.ts | ZIP/JSON, strict schema, 원본 에셋, CRC·ZIP bomb 방어 유지 | vectorDocuments JSON과 참조 layer를 v2로 저장 | 신규 앱 v1/v2 지원; vector 편집 전 v1 유지; UTF-8 manifest 초과는 편집 반영 전 거부 | V-PROJECT-01/02/03 unit·UI·native 통과 |
| 자원 | src/types/project.ts, src/core/import/png.ts | 원본 PNG/GLB base64, ZIP 원본 바이트 보존 | vector image는 같은 assets 참조 | 원본 재인코딩 없음; 문서 간 복사 시 충돌 ID 재매핑 | PNG/GLB ZIP 바이트 비교, embedded PNG clip 해제 UI 통과 |
| 자동 복구/내 모델 | src/core/project/autosave.ts, src/core/storage/local.ts | IndexedDB 복구 ZIP과 GLB 라이브러리 | 같은 프로젝트 저장기를 통과 | v2 복구, 기존 catalog 호환 | 기존 autosave.spec, V-PROJECT-03 |
| 입력·단축키 | App.tsx, DesignCanvas.tsx | 입력/IME 우선, 공통 저장/명령 검색 | vector 도구 키는 vector 영역에서만 소유 | A/P/M/L/V/T/H/Z와 기존 키 충돌·IME | V-UI-03 |
| SVG | src/core/vector/svg.ts | 안전한 공개 규격 subset parser/writer 추가 | 원본 markup 대신 정규화 문서를 사용 | 위험 XML/외부 자원 거부; 손실 경고 및 원본 SVG 별도 보관 정책 | V-SVG-01/02/SEC unit·UI·native 통과 |
| 글꼴/윤곽선 | src/core/vector/text.ts, public/fonts | OFL Noto 정적 Regular 400 로컬 번들 | editable text와 실제 glyph path 공유 | 지원하지 않는 font/weight는 정확한 윤곽선으로 대체하지 않고 거부 | text unit·UI·동일 픽셀·app:// OTF 로딩 통과 |
| 빌드/라이선스 | package.json, forge.config, scripts/* | Vite renderer + Electron bundle + ZIP + notices | 기존 빌드/검사 시스템 사용 | 새 library/font·번들 내 포함 코드 고지 확인 | typecheck/build·최종 package/코드·notices 일치 통과 |

## 통합 검증 상태

단위/보안 전체 147개, 집중 벡터 UI 6개, 실제 브라우저 렌더 4개, 통합 Electron 전체 4개가 통과했다. 핵심 증거는 경로/앵커 실제 변경, 한 drag 한 Undo, 투명 구멍/gradient/clip 픽셀, 실제 WebGL 갱신, editable v2 재열기, 원본 PNG/GLB 바이트, native SVG 저장, 로컬 OTF의 `app://` 응답과 FontFace 로딩이다.

통합 Electron은 Linux/Xvfb에서 현재 production renderer/main/preload를 사용했다. Windows ZIP 실행 검증과 동일하지 않다. 잠금·변환된 열린 패스 이어그리기·마스크복사·그룹/클립/뒷판 회귀를 포함한 최종 전체 Chromium 24개, 최종 빌드 native 4개, Linux 패키지 재실행 4개와 ZIP·코드·고지 CRC/hash 검사를 통과했다. 상세 결과는 [VECTOR_TEST_PLAN.md](VECTOR_TEST_PLAN.md)와 [VECTOR_RESULTS.md](VECTOR_RESULTS.md)에서 확정한다.

추가 QA에는 벡터의 소매 적용, 모든 선택/레이어/아트보드 조합, 실제 OS IME, Windows/macOS GUI, 대형 문서 성능이 남는다. [VECTOR_GAPS.md](VECTOR_GAPS.md)에 기능 제약과 검증 한계를 나누어 기록했다.

현재 STULOOMA 자체 코드는 분석·수정 대상이다. 경쟁 상용 프로그램이나 다른 벡터 앱의 비공개 구현은 감사 대상이 아니다. 최종 패키지 해시와 게시 링크는 결과 기록에서 확정한다.
