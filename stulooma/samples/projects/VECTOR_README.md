# 편집 가능한 Vector Studio 예제

- `vector-compound-3d.stulooma`: 실제 UI에서 SVG를 가져와 복합 패스의 구멍·선형 그라디언트·클리핑을 편집하고 앞판에 연결한 프로젝트. 열기 → **Vector Studio** → `ring` 선택 → 칠 변경으로 3D 갱신을 확인한다.
- `vector-korean-outlines.stulooma`: 번들 Noto Sans CJK KR Regular의 `OABP 정관장 23`을 실제 글리프 경로로 변환한 예제. **직접 선택**에서 앵커와 내부 구멍을 편집할 수 있다. 이 프로젝트에는 의류 연결을 추가하지 않았다.

두 파일은 Chromium 통합 검사에서 저장·검증한 v2 프로젝트다. 새 0.3.0 이상으로 열며, 이전 0.2.0 앱에서는 미래 버전으로 거부된다. Undo 이력은 파일에 저장되지 않는다. SVG 시험 원본은 `../vector/`에 있다. 실제 OS IME·인쇄 색상·제조 치수 검증을 뜻하지 않는다.
