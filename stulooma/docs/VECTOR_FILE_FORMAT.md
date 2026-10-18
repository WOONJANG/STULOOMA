# Vector Studio 파일 형식·안전 정책

## 프로젝트 호환성

`.stulooma` ZIP 컨테이너와 원본 PNG/GLB 경로는 유지한다. 벡터를 추가하지 않은 기존 문서는 `ProjectDocument.version: 1`이다. 처음 벡터 문서를 저장하는 편집은 프로젝트를 `version: 2`로 올리고 선택 필드 `vectorDocuments: Record<string, VectorDocument>`를 추가한다. 새 앱은 v1과 v2를 읽는다. 이전 0.2.0 앱은 v2를 미래 형식으로 거부하므로 벡터를 조용히 지우고 덮어쓰지 않는다.

```text
manifest.json             # v1 또는 v2, v2에 편집 가능한 vectorDocuments
assets/<asset-id>.png      # 수정하지 않은 원본 PNG
assets/<asset-id>.glb      # 수정하지 않은 원본 사용자 모델
```

새 ArtworkLayer `type: vector`는 `vectorDocumentId`와 `vectorArtboardId`로 기존 프로젝트 내부의 문서·아트보드를 참조한다. regionId 및 x/y/width/height/rotation/opacity/visible/locked는 기존 artwork와 동일하다. 벡터 데이터 없이 PNG만 저장하거나 기존 래스터를 자동 벡터화하지 않는다. 원본 PNG/GLB의 재인코딩은 하지 않는다.

## VectorDocument v1

| 구조 | 저장 내용 |
|---|---|
| 문서 | id/name/version=1/artboards/objects/assets/metadata? |
| 아트보드 | id/name/x/y/width/height/unit/background |
| 객체 | id/name/type/parentId/artboardId/transform/opacity/visible/locked/fill/stroke; 타입별 geometry/text/image |
| path | contours와 fillRule(nonzero/evenodd) |
| contour | anchors와 closed |
| anchor | id/x/y/in?/out?/kind(corner/smooth/symmetric) |
| paint | none/solid/linear/radial; 색·알파·gradient transform·stops |
| stroke | paint/width/lineCap/lineJoin/miterLimit/dash/dashOffset |
| text | content/fontFamily/fontSize/fontWeight/letterSpacing/lineHeight/alignment |
| image | assetId/width/height; 기존 PNG 자원만 참조 |
| 클립/마스크 | 같은 문서 객체를 참조하는 clipPathId/maskId; 순환 불가 |

문서 버전과 프로젝트 버전은 독립이다. 객체·아트보드 ID는 유일해야 하고 parent는 같은 아트보드의 group이어야 한다. prototype 키·NaN/Infinity·잘못된 색·누적 행렬 폭증·그룹/clip/mask 순환·누락된 이미지/문서/아트보드는 거부한다. 저장 경로·Electron 권한 token·React/GPU 객체는 JSON에 포함하지 않는다.

검증 상한: vector 문서 32, 문서당 아트보드 32·객체 10,000·앵커 100,000·contour 10,000·계층 64·gradient stop 64. 좌표 절댓값 10,000,000, local matrix 성분 1,000,000, 누적 matrix 10^12. 상한 내라도 기존 manifest 2MiB·ZIP64MiB·팽창96MiB 제한이 우선한다. 큰 벡터 문서는 이 컨테이너 한도에 먼저 도달할 수 있다.

## SVG 교환 범위

SVG는 공개 교환 형식이며 프로젝트의 모든 편집 메타데이터를 보존하는 원본 형식이 아니다. 실제 기본 정규화 대상은 svg/g/path/rect/circle/ellipse/line/polyline/polygon/text, linear/radial gradient, clipPath, embedded PNG다. M/L/H/V/C/S/Q/T/A/Z와 상대 명령을 자체 경로로 바꾼다. 중첩 translate/rotate/scale/skewX/skewY/matrix는 행렬 순서를 유지한다.

importer는 지원되는 편집 데이터와 `metadata.svgImportWarnings`만 보관하며 **원본 SVG 바이트는 보관하지 않는다**. 원본을 따로 보관해야 원본의 미지원 효과를 다시 사용할 수 있다. UI는 가져온 결과의 경고를 알리며 완전 왕복 보존을 주장하지 않는다.

- 지원: 기본/둥근 도형·전체 경로 명령·중첩 그룹·affine 변형·단색·선 설정·선형/방사형 gradient와 같은 종류의 로컬 href 상속, userSpaceOnUse clip, text/기본 multiline, 로컬 embedded PNG의 원본 bytes와 meet/none 배치.
- 경고 후 생략/정규화: 알 수 없는 안전 요소/속성/style, filter/animate, pattern 등 미지원 paint server(투명으로), 반복/반사 gradient(pad로), objectBoundingBox clip, SVG opacity mask, tspan 개별 서식·문자 상세 dx/dy/rotate/textLength, nested SVG viewport clipping, image slice(meet로). 지원하지 않는 색은 경고 후 검정으로 대체한다.
- 안전상 거부: script/이벤트, style 요소/외부 CSS, foreignObject/iframe/object/embed/use, 외부 href와 URL, DOCTYPE/entity/처리명령, 손상 XML·중복 ID·누락/순환 로컬 참조·과도한 입력. symbol/use를 일반 SVG 가져오기 기능으로 주장하지 않는다.

SVG 입력 한도는 UTF-8 12MiB, element 5,000, 정규화 object 2,000, depth 32, anchor 100,000, text 100,000자, gradient stop 64다. DOM 생성 전에도 markup 개수를 제한하여 매우 많은 작은 태그가 무제한 DOM을 할당하지 못하게 한다. path 개별 데이터 한도는 2MiB다. 출력은 기본 현재 아트보드이며 writer API는 선택 객체 범위를 받을 수 있지만 전체 아트보드 일괄 UI 출력은 제공하지 않는다.

script, on* 이벤트, DOCTYPE/entity, 처리 명령, 외부 네트워크/file href, JavaScript URL, 외부 CSS·URL 자원, 손상 XML, 제한을 넘는 깊이/요소/path는 거부한다. `.svg` 업로드 필터만으로 안전하다고 판단하지 않는다. 비실행 XML DOM으로 읽고 허용된 수치·색·경로·참조만 자체 문서에 전달한다.

SVG export는 XML escaping, 실제 path·fillRule·matrix·paint·지원 클립/이미지/문자를 내보낸다. vector를 PNG로 대체하지 않는다. PNG 출력은 실제 벡터 렌더를 래스터화하는 명시적 출력이며 editable 원본을 변경하지 않는다.

## 미지원 교환 형식

AI 비공개 편집 데이터, AI 완전 왕복, PDF 편집 입력, ICC/CMYK·인쇄 분판은 지원하지 않는다. PDF 출력은 실제 writer/폰트 임베딩·페이지 테스트가 구현된 뒤에만 제공한다. 기존 PNG/JPG/GLB 목업 출력은 유지한다. JPEG/WEBP vector 이미지 배치는 구현한 경우에만 목록에 추가한다.
