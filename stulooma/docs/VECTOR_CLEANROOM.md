# Vector Studio 클린룸 개발 기록

확인일: 2026-10-18 (Asia/Seoul). 대상은 기존 STULOOMA에 추가하는 독립 구현 벡터 모듈이다. 아래 공개 사용자 문서와 공개 SVG 규격, 범용 라이브러리의 공개 API 문서만 참고했다. 상용 앱의 소스·실행 파일·비공개 AI 편집 데이터와 다른 벡터 편집 앱의 애플리케이션 코드를 열람·복사하지 않았다. STULOOMA 자신의 소스는 개발 대상이므로 구조·회귀 분석에 사용했다.

## 실제 접근한 공식 자료

HTTP 응답과 redirect, 제목, 응답 바이트 수, UTC 접근 시각은 [access.json](evidence/vector-research/access.json)에 기록했다. 각 자료의 짧은 발췌만 보관하며 전체 도움말을 앱에 재배포하지 않는다. 아래 성공 상태는 해당 문서에 실제 접근했다는 뜻이며 외부 제품 기능 전체를 재현했다는 뜻이 아니다.

| 공식 문서 | HTTP | 접근일 | 확인한 내용의 짧은 발췌 |
|---|---|---|---|
| [Illustrator 데스크탑 도움말](https://helpx.adobe.com/kr/illustrator/user-guide.html) | 200 | 2026-10-18 UTC | Illustrator 데스크탑 도움말 |
| [Illustrator의 기본 키보드 단축키 / Illustrator](https://helpx.adobe.com/kr/illustrator/using/default-keyboard-shortcuts.html) | 200 | 2026-10-18 UTC | [직접 선택] 도구와 [그룹 선택] 도구 간 전환 |
| [Learn how to create and modify paths and shapes in Adobe Illustrator. / Illustrator](https://helpx.adobe.com/illustrator/using/artwork-essentials/paths-and-shapes.html) | 200 | 2026-10-18 UTC | A path contains one or more straight or curved line segments that you draw on canvas using the Pen, Pencil, or Curvature tool. |
| [Edit overlapping objects with Pathfinder in Illustrator | Illustrator](https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/combine-objects-using-pathfinder-effects.html) | 200 | 2026-10-18 UTC | When you apply a Pathfinder option, you permanently change the original objects. |
| [Edit clipping masks in Illustrator | Illustrator](https://helpx.adobe.com/illustrator/desktop/manage-objects/edit-objects/edit-clipping-masks.html) | 200 | 2026-10-18 UTC | Learn how to change the shape and content of clipping masks to control which parts of the artwork are visible within defined shapes. |
| [Illustrator에서 아트워크를 저장하는 방법 / Illustrator](https://helpx.adobe.com/kr/illustrator/using/saving-artwork.html) | 200 | 2026-10-18 UTC | PDF 및 SVG 형식의 경우 모든 Illustrator 데이터를 보존하려면 Illustrator 편집 기능 보존 옵션을 선택해야 합니다. |
| [Scalable Vector Graphics (SVG) 2](https://www.w3.org/TR/SVG2/) | 200 | 2026-10-18 UTC | Scalable Vector Graphics (SVG) 2 |
| [Paths — SVG 2](https://www.w3.org/TR/SVG2/paths.html) | 200 | 2026-10-18 UTC | An elliptical arc segment draws a segment of an ellipse. |
| [Coordinate Systems, Transformations and Units — SVG 2](https://www.w3.org/TR/SVG2/coords.html) | 200 | 2026-10-18 UTC | Coordinate Systems, Transformations and Units |
| [Painting: Filling, Stroking and Marker Symbols — SVG 2](https://www.w3.org/TR/SVG2/painting.html) | 200 | 2026-10-18 UTC | The fill-rule property provides two options for how the inside of a shape is determined: nonzero; evenodd. |
| [Scripting and Interactivity — SVG 2](https://www.w3.org/TR/SVG2/interact.html) | 200 | 2026-10-18 UTC | This chapter describes scripting and interactivity in SVG. |
| [Security / Electron](https://www.electronjs.org/docs/latest/tutorial/security) | 200 | 2026-10-18 UTC | Enable context isolation in all renderers; Enable process sandboxing. |

`user-guide.html`은 Adobe의 한국어 `/kr/illustrator/desktop.html`로 이동한 응답이다. Adobe 도움말은 경로/앵커/칠/선·선택·사용자 관찰 가능 도형 연산·클립 수정·파일 저장 차이만 기능 요구 근거로 삼았다. Adobe의 고유 아이콘·패널 배치·폰트·템플릿을 추출하지 않았다.

## 자체 구현과 재사용 경계

| 기능 | 독립 구현 방식 | 공개 근거 |
|---|---|---|
| 경로/앵커/핸들 | 직렬화 가능한 앵커·윤곽과 3차 베지어, 자체 파서/변환/분할 | SVG2 Paths, Adobe paths and shapes |
| 변형/단위 | 6성분 affine matrix, 문서 좌표와 화면 zoom 분리 | SVG2 Coordinate Systems |
| 합집합/빼기/교집합/XOR | 자체 곡선 평탄화 → 범용 polygon clipping → 실제 편집 경로 | Adobe 공개 Pathfinder 사용 동작, 라이브러리 공개 API |
| 복합 패스/구멍 | 여러 윤곽과 evenodd/nonzero 규칙, 흰색 덮개 금지 | SVG2 Painting |
| SVG 입출력 | 허용 목록 parser, 자체 문서 모델, escaped XML writer | SVG2, Electron Security |
| 3D 연결 | 기존 STULOOMA UV/Texture Composer에 vector 문서 참조 레이어 추가 | 기존 자체 코드; 타사 3D 코드 사용 없음 |
| 문자 외곽선 | 권리가 확인된 로컬 Noto 글리프를 공개 OpenType 라이브러리로 경로화 | opentype.js 공식 API README, OFL |

## 범용 라이브러리와 폰트

실제 설치 버전의 `package.json`과 README API/라이선스 표시를 확인했다. 앱 코드를 복제한 것이 아니라 특정 공개 라이브러리를 의존성으로 사용한다. 정확한 배포 고지는 저장소의 THIRD_PARTY_NOTICES와 bundle audit를 따른다.

| 항목 | 고정 버전 | 라이선스 | 용도 / 확인 자료 |
|---|---|---|---|
| polygon-clipping | 0.15.7 | MIT | polygon Boolean API; `node_modules/polygon-clipping/README.md` |
| @xmldom/xmldom | 0.9.12 | MIT | 비실행 XML DOM 파싱; `node_modules/@xmldom/xmldom/readme.md` |
| opentype.js | 2.0.0 | MIT | 글리프 path API; `node_modules/opentype.js/README.md` |
| Noto Sans CJK KR Regular | 정적 Regular 400 | OFL-1.1 | 한글 포함 실제 외곽선; 아래 공식 출처와 고정 SHA-256 |
| 기존 Noto Sans KR Variable | 5.3.1 패키지 | OFL-1.1 | 기존 UI/캔버스 문자; 기존 고지 유지 |

정적 OTF 출처: [Noto CJK 공식 저장소](https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf). 16,433,112 bytes, SHA-256 `6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a`. 라이선스는 [같은 공식 저장소 Sans/LICENSE](https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE), SHA-256 `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`이며 `public/fonts/NotoSansCJKkr-LICENSE.txt`로 배포한다. renderer 담당 에이전트가 실제 내려받은 파일과 해시를 확인했다.

윤곽선 변환의 정확한 로컬 family는 `STULOOMA Noto Sans KR`, weight 400이다. 다른 family/weight나 없는 글리프는 조용히 치환하지 않고 오류를 반환한다. 기존 UI의 variable font와 실제 외곽선용 정적 font의 차이를 구분한다. OTF를 쓴 문서의 윤곽선은 이미지 대체가 아닌 벡터 경로다. 사용자가 제공하지 않은 유료/시스템 폰트를 임의로 포함하지 않는다. AI 완전 호환, Illustrator 내부 알고리즘 재현, ICC 없는 인쇄 색상 정확도를 주장하지 않는다.

## 자체 시험 자료

[samples/vector](../samples/vector/README.md)의 SVG는 공개 SVG 문법으로 이 저장소에서 직접 작성했다. 타사 앱 파일을 역공학하지 않았다. 외부 이미지·script/onload·HTML foreignObject가 있는 자료는 명시적인 거부/경고 보안 시험이며 실제 실행을 허용하는 샘플이 아니다.
