# 미구현·제약·추가 검증

STULOOMA 0.2.0 · 2026-10-18. 작동하는 핵심 편집 흐름을 유지하며 아래 항목을 실제 구현·검증 전 완료로 표시하지 않는다. P0 전체 완료 여부는 [SPEC.md](SPEC.md)와 [TEST_PLAN.md](TEST_PLAN.md)의 실제 인수 결과에 따른다.

| 기능 | 현재 상태 / 이유 | 필요한 기술·작업 | 우선순위 | 현재 대안 |
|---|---|---|---|---|
| Windows 네이티브 실행 | Linux에서 교차 ZIP 제작 가능; Windows GUI 검증 없음 | Windows10/11 실제 실행·저장·GPU·한글·파일 연결 검사 | P0 검증 | Linux에서 검증한 개발판과 소스 제공 |
| macOS 앱·공증 | 설정 구조만 준비; 빌드/실행 없음 | macOS SDK/장치, signing/notarization, 파일 연결 | P0 플랫폼 | Linux/Windows ZIP 목표 유지 |
| Linux OS sandbox | 컨테이너의 namespace/SUID 제약으로 시험에서만 `--no-sandbox` | 정상 OS에서 Chromium sandbox 동작·배포 권한 확인 | P0 검증 | 배포 코드의 sandbox/격리 설정 유지, 한계 명시 |
| 외부 GLB 일부 mesh 영역 | mesh별 FRONT/BACK 등 지정 가능; 단일 mesh 내 삼각형/UV 선택 없음 | face selection, UV polygon mask, region 참조 저장 | P0 제약 | 외부 모델링 도구에서 mesh·UV를 나누어 GLB 저장 |
| 일반 glTF 파일 | 자체 포함 GLB만 구현; JSON+외부 buffer/image 묶음 미지원 | 다중 자원 안전 해석·파일 묶음 UI·저장 | P0 제약 | 외부 도구에서 GLB로 export |
| 가져온 모델의 기존 재질 편집 | GLB 원본 바이트는 보존하지만 편집 화면은 부위 색상·PBR 설정으로 덮어 표현 | 원본 material 슬롯과 사용자 디자인 합성 계약·UI 추가 | P1 | 원본 GLB는 별도로 보관; 현재는 새 디자인 목업 사용 |
| GLB 고급 기능 | URI 자원·일부 확장·압축/스킨·애니메이션 등 제한 | 검증 가능한 decoder, 리소스 제한, 편집 보존 계약 | P0 제약 | UV 포함 정적·자체 포함 비압축 GLB |
| 자동 UV·UV 섬 편집 | UV 유무/범위 검사만; UV 생성·겹침/왜곡의 완전 자동 진단 없음 | unwrap, overlap/distortion 분석·시각 편집 | P2 | UV가 있는 파일만 등록; 외부 UV 제작 |
| 모든 UI/IME 조합 | 자동 한국어 문자열·단축키 가드 검사 가능; 실제 OS IME 미검증 | Windows/macOS 한글 IME 실제 조합·Undo 검사 | P0 검증 | UTF-8 저장·composition 가드 유지 |
| 전체 상용 출시 요건 | unsigned 개발판; 배포 정책·대상 OS 출시 검증 필요 | [LICENSES.md](LICENSES.md) 변경 시 재검토·자체 배포권·서명·대상OS QA | 출시 필수 | 개발용 소스·테스트·ZIP 제공 |
| 후드/긴팔/축구/야구/하키 모델 | 실제 기본 모델은 반팔·농구 상의 2종 | 독립 모델·부위·UV·재질·품질/복원 테스트 | P1 | 사용자 권리 있는 GLB 등록 |
| 고급 텍스트·마킹 | 기본 한글/영문 text 레이어; 선수명/번호 전용 객체·자간·아치·외곽선 미구현 | typography 데이터·레이아웃·프리셋·폰트 검사 | P1 | 일반 텍스트 레이어로 배치 |
| SVG/JPG/WEBP 가져오기 | PNG만; SVG 안전 subset 처리기 없음 | MIME/header 검사·SVG sanitization·rasterization | P1 | 외부 도구에서 투명 PNG로 변환 |
| 다중 선택·그룹·flip | 0.2.0에서 단일 레이어 앱 내 복사/붙여넣기·6방향 정렬·스냅 구현; 다중 선택·group·flip 없음 | 다중 선택 계약·명령 묶음·변환/마스크 보존 | P1 | 단일 레이어 선택·복사·정렬과 수치 편집 |
| 반복 패턴·전체 프린트 | 시험용 패턴 PNG는 있음; repeat/경계 연속 UI 없음 | tiling layer·phase·마스크·부위 경계 정합 | P1 | 반복 이미지를 PNG로 제작해 부위 배치 |
| 고급 원단·normal map | 색상·roughness·metalness와 기본 표현 프리셋 | 원단 자산 권리 확인·normal/bump·repeat·저장 | P1 | PBR 수치 조정; 실제 원단 물성 아님 |
| 디자인 비교·변형 | 프로젝트별 한 디자인; 홈/원정 동시 비교 없음 | variant model·diff·비교 렌더 | P1 | 별도 `.stulooma` 저장 |
| 다중 시점·batch 출력 | 현재 카메라 PNG/JPG/GLB만 | 카메라 job queue·취소·ZIP·프레임 안정화 | P1 | 시점을 바꾸며 개별 출력 |
| 텍스처/UV atlas 전용 출력 | 현재 3D 이미지와 GLB; 생산용 패턴 데이터 없음 | atlas packaging·원본/부위 출력 UI·치수 검증 | P1 | GLB 및 원본 PNG 유지 |
| 사용자 지정 출력 크기 | 1024/2048/4096 선택; 임의 치수 없음 | 장치 한도 검사·메모리 관리·타일 렌더 | P1 | 정해진 출력 크기 |
| 자동 저장 백업·충돌 복구 | 최신 로컬 복구만; 세대 백업·충돌 해결 없음 | 보존 정책·복구 UI·실패 복원 | P1 | 수동 다른 이름 저장·외부 백업 |
| 사용자 분류·모델 메타데이터 | 로컬 사용자 모델 등록; 카테고리 편집·썸네일 세부 관리 없음 | library schema·migration·preview 생성 | P1/P2 | 기본 의류/내 모델 구분 |
| 사용자 치수·형상 편집 | 기본 모델 자체는 코드 파라메트릭; 사용자 fit/치수 UI 없음 | 조절 parameter contract·형상/UV 보존·단위 보정 | P2 | 외부 도구에서 새 GLB 제작 |
| 부품 조립 | 미구현; 단순 겹침을 접합으로 제시하지 않음 | boundary/connectors·topology·봉합 검증 | P2 | 완성 모델을 가져오기 |
| 2D 의류 패널 CAD | 미구현; 현재 2D는 프린트 디자인 캔버스 | curves·치수·봉제선·패널↔메시 대응 | P2 | 외부 CAD 도구 사용 |
| 마네킹·체형·포즈 | 실제 마네킹/스켈레톤 없음 | 권리 확인 메시·rig·measurements·충돌 검사 | P2 | 의류 단독 제품 목업 |
| 물리 원단·정확한 피팅 | 미구현. 정적 메시·PBR은 물리 시뮬레이션 아님 | cloth solver·충돌·물성·정량 검증 | P3 | 정적 3D 목업으로 한정 |
| 선수 CSV·사이즈 일괄 제작 | 미구현 | CSV validation·열매핑·variant·batch render | P3 | 일반 텍스트와 별도 프로젝트 |
| 제작 데이터·실측 치수 | 정규화 디자인 좌표; 제조 규격 검증 없음 | 단위 교정·재단/봉제 tolerance·제조 포맷 | P3 | 시각 목업과 생산 파일 분리 |
| 협업·클라우드·원격 분석 | 미구현; 기본 로컬/오프라인 | 권한·충돌·암호화·명시적 사용자 동의 | P3 | 파일로 프로젝트 전달 |
| 고급 렌더·성능 보고 | 실시간 기본 조명; 고급 HDRI/렌더 queue·실측 benchmark 없음 | 권리 확인 환경맵·계측·장치별 profiling | P3 | 현재 렌더 출력; 미측정 수치 보고 안 함 |
| 자동 업데이트·설치 프로그램 | Portable ZIP만; updater/MSI/DMG 없음 | 서명·신뢰 가능한 배포·롤백·정책 | 출시 확장 | 개발용 ZIP 수동 배포 |

CLO 공식 도움말 웹사이트는 이 환경에서 프록시 403으로 본문을 확인하지 못했다. 해당 제품의 내부 자료를 대신 조사하지 않았으며 사용자 요구와 공개 규격·범용 라이브러리 공식 문서로 독립 구현했다. 상세 출처는 [SOURCES.md](SOURCES.md).
