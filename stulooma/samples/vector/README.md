# Vector Studio 독립 시험 자료

2026-10-18 KST에 이 저장소에서 직접 작성한 최소 SVG입니다. 제3자 프로그램에서 추출한 자료가 아닙니다. 선·곡선·도형·구멍·그라디언트·클립·문자·중첩/회전과 오류/보안/미지원 입력을 분리합니다.

`11-external-image.svg`는 example.invalid의 가상 주소를 담은 외부 자원 거부 시험입니다. `12-malformed.svg`는 의도적으로 잘못된 XML입니다. `13-dangerous.svg`는 실행을 검출하는 script/onload 문자열이 있는 거부 시험이며 앱은 이를 DOM 문서로 삽입하지 않아야 합니다. `14-unsupported.svg`는 필터·애니메이션 손실 경고 시험입니다. `15-arcs.svg`는 타원호 정규화 시험입니다.

샘플의 존재는 해당 기능 완료를 뜻하지 않습니다. 실제 지원/거부/경고 범위는 [형식 정책](../../docs/VECTOR_FILE_FORMAT.md), 결과는 [검사 계획](../../docs/VECTOR_TEST_PLAN.md)을 따릅니다.
