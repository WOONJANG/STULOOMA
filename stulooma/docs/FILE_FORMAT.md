# STULOOMA 프로젝트 형식 v1

`.stulooma`는 로컬에서 생성·해석하는 ZIP 컨테이너입니다. 파일을 열거나 저장할 때 프로젝트를 서버로 전송하지 않습니다. 공개 PNG·glTF 2.0·ZIP 규격을 사용하며, 다른 의류 소프트웨어의 비공개 형식과 호환성을 주장하지 않습니다.

## 컨테이너 구조

```text
manifest.json
assets/<asset-id>.png
assets/<asset-id>.glb
```

`manifest.json`은 UTF-8 JSON입니다. `format`은 `STULOOMA`, `version`은 정수 `1`입니다. 알 수 없는 필수 버전이나 스키마 필드는 경고 오류로 거절하여 데이터가 손실된 상태로 다시 저장되는 것을 막습니다. 선택 확장 정보는 `metadata` 객체에 보관하고 다시 저장할 때 유지합니다.

컨테이너는 단일 디스크 ZIP32의 저장 방식 0 또는 DEFLATE 방식 8을 지원합니다. 암호화 ZIP, ZIP64, 스트리밍 데이터 디스크립터, 심볼릭 링크의 파일 시스템 추출은 지원하지 않습니다. 파일은 디스크 경로에 압축 해제하지 않고 검증된 바이트로만 읽습니다. 저장기는 `fflate`로 동일한 지원 규격을 생성합니다.

## 프로젝트 데이터

정확한 TypeScript 스키마는 `src/types/project.ts`, 실행 시 검증기는 `src/core/validation/project.ts`에 있습니다.

| 필드 | 내용 |
| --- | --- |
| `format`, `version` | 고정 식별자와 필수 형식 버전 |
| `id`, `name` | 프로젝트 ID와 한국어를 지원하는 이름 |
| `createdAt`, `updatedAt` | ISO 날짜 문자열 |
| `garment` | 기본 티셔츠·농구복 또는 사용자 GLB, 선택적인 부위별 메시 연결 |
| `activeRegion`, `regions` | 선택 부위와 각 부위의 색상·roughness·metalness |
| `layers` | 독립적인 PNG·텍스트 레이어, 앞뒤 부위, 위치·크기·회전·투명도·표시·잠금 |
| `assets` | 원본 이름, ID, MIME, 실제 파일 경로 참조 |
| `camera` | 위치와 바라보는 지점 |
| `settings` | 작업 텍스처 해상도, 배경색, 투명 배경, 간편·전문가 모드 |
| `metadata` | 지원하지 않는 선택 정보도 보존하는 크기 제한 JSON 객체 |

부위 식별자는 `FRONT`, `BACK`, `COLLAR`, `LEFT_SLEEVE`, `RIGHT_SLEEVE`, `LEFT_SIDE`, `RIGHT_SIDE` 등의 논리 ID입니다. 사용자 GLB의 `regionMeshes`는 부위 ID를 하나 이상의 메시 이름에 연결합니다. 하나의 메시를 중복 부위에 연결하는 입력은 거절합니다.

레이어의 `x`, `y`, `width`, `height`는 각 부위의 UV 작업면에 대한 정규화 값입니다. `x`, `y`는 레이어 중심이고 회전은 도 단위입니다. 레이어 배열 순서가 합성 순서입니다. 이미지 레이어는 존재하는 PNG 에셋을, 사용자 의류는 존재하는 GLB 에셋을 참조해야 합니다. 같은 프로젝트에서 레이어 ID와 에셋 ID는 각각 유일해야 합니다.

런타임의 `AssetRecord.data`는 원본 바이트의 완전한 base64 data URL입니다. 저장할 때 이 값만 `assets/<id>.<ext>` 참조로 바꾸고 원본 PNG·GLB 바이트를 ZIP에 기록합니다. 다시 열 때 원본 바이트를 data URL로 복원합니다. 이미지 재인코딩이나 모델 재생성을 하지 않으므로 수정하지 않은 에셋은 바이트 단위로 보존됩니다.

## 안전 제한과 오류 처리

| 대상 | 제한 |
| --- | --- |
| ZIP 파일 | 64 MiB |
| 압축 해제 합계 | 96 MiB |
| 매니페스트 JSON | 2 MiB |
| PNG 하나 | 16 MiB, 16,777,216 픽셀, 한 축 최대 8192 |
| GLB 하나 | 32 MiB, JSON 청크 최대 2 MiB |
| 에셋·레이어·부위 | 각각 64·500·32개 |
| 선택 메타데이터 | 최대 깊이 16, 노드 10,000개, 직렬화 문자열 512 KiB |

압축 해제 **전에** 중앙 디렉터리와 로컬 헤더를 대조하고 경로, 파일 개수, 크기, 중복·대소문자 충돌, 엔트리 중첩 및 숨겨진 파일을 검사합니다. 이어 독립적인 RFC 1951 토큰 검사기가 출력 버퍼를 만들지 않고 실제 DEFLATE 확장량을 계산합니다. 따라서 거짓 크기 필드를 사용하는 ZIP bomb도 선언된 크기를 넘어 확장되기 전에 거절합니다. 검사가 끝난 뒤 제한된 출력 버퍼에만 압축을 해제하고 CRC-32를 확인합니다.

PNG는 서명, IHDR 크기·색 형식, 모든 청크 경계와 CRC, 종료 청크를 확인합니다. GLB는 magic·버전·전체 크기, 청크 순서·범위·정렬, glTF 2.0 JSON을 검사합니다. 외부 파일·네트워크·data URI는 허용하지 않으며 모든 리소스는 BIN 청크에 포함해야 합니다. 필수 glTF 확장은 가져오기·프로젝트 저장 계층이 공유하는 `src/core/validation/glb-policy.ts` 목록만 허용합니다. 모델 가져오기 계층은 별도로 메시·UV·접근자·텍스처 제한을 검사합니다. 손상된 프로젝트는 기존 열려 있는 문서를 교체하기 전에 오류를 반환합니다.

색상·수치·문자열·배열·참조 관계에도 경계 검사를 수행합니다. JSON의 `__proto__`, `constructor`, `prototype` 키를 거절하고 유효하지 않은 UTF-8도 거절합니다. ID는 ASCII 영숫자·밑줄·하이픈으로 1~128자이며 사용자 표시 이름·텍스트는 한국어를 유지합니다.

## 저장·복구 API

- `createProject('tshirt' | 'basketball')`: 편집 가능한 빈 프로젝트. `'custom'`은 GLB 등록 후 검증 가능한 초안입니다.
- `validateProject(value)`: 호출자의 데이터를 변경하지 않고 검증된 깊은 복사본을 반환합니다.
- `saveProject(project)`: 검증된 ZIP 바이트를 반환합니다.
- `loadProject(bytes)`: 모든 컨테이너·에셋·참조를 검증한 프로젝트를 반환합니다.
- `autosaveProject`, `restoreAutosave`, `clearAutosave`: 브라우저 IndexedDB의 `STULOOMA-local-projects/recovery`에 마지막 프로젝트를 로컬 저장·복원·삭제합니다. 오류는 호출자에게 전달합니다.

파일 시스템 쓰기와 안전한 임시 파일 교체는 Electron Main Process가 담당합니다. 자동 저장은 수동 저장의 원본을 덮어쓰지 않습니다. 개발 중인 v1은 이전 버전에서의 마이그레이션을 제공하지 않으며, 지원하지 않는 필수 버전을 열어 변환하지 않습니다.

## 재현 검증

```sh
npx vitest run tests/unit/project.test.ts tests/security/project-security.test.ts
```

테스트는 한국어 이름·텍스트, 앞판·뒷판, 원본 PNG·GLB 바이트, 재질·카메라, 선택 메타데이터, 다단계 Undo/Redo와 드래그 그룹, 경로 순회, 충돌, 크기 위조, 실제 DEFLATE 초과 확장, CRC 손상, 잘못된 참조 및 파일 헤더를 검증합니다. `samples/projects/korean-front-back.stulooma`는 같은 저장기를 사용한 독립 제작 예제입니다.
