# STULOOMA

한국어 기반 로컬 3D 의류 디자인·목업 편집기입니다. 기본 반팔과 농구 상의에 PNG·텍스트를 배치하고 3D로 확인하며, 편집 가능한 프로젝트와 PNG/JPG/GLB를 저장합니다.

## Windows 실행

**[STULOOMA 0.2.0 개발판 다운로드](https://github.com/WOONJANG/STULOOMA/releases/tag/v0.2.0-dev)**

1. 릴리스 본문의 **Windows 실행 ZIP 다운로드** 링크를 누릅니다.
2. ZIP 전체의 압축을 풉니다.
3. `STULOOMA-win32-x64` 폴더의 `STULOOMA.exe`를 실행합니다.

`resources` 등 함께 들어 있는 파일을 유지하세요. 현재 서명되지 않은 개발판이며, Windows 네이티브 실행은 아직 검증하지 않았습니다. macOS 패키지는 제공하지 않습니다.

## 구현·검증 범위

독립 제작한 3D 의류 2종, 부위별 UV·색상·재질, 2D 이미지 이동·크기·회전, 텍스트, Undo/Redo, 저장·복원, PNG/JPG/GLB 출력, 사용자 GLB 등록과 로컬 복구를 제공합니다. 0.2.0에서는 메뉴·명령 검색(Ctrl+K), 독립 스크롤 레이어 패널, 작업 공간 조절, 복사/붙여넣기·정렬·미세 이동, 2D 확대·팬·스냅, 반복 저장과 다른 이름 저장을 추가했습니다. Linux에서 자동 검사 91개를 통과했습니다. 실제 검증 결과는 아래 보고서에 기록합니다. 패턴 CAD·물리 착의 시뮬레이션 등은 미구현입니다.

[검증 보고서](stulooma/docs/RESULTS.md) · [남은 기능과 제약](stulooma/docs/GAPS.md) · [라이선스 고지](stulooma/docs/LICENSES.md)

## 소스로 실행

Node.js 24 LTS와 npm을 준비한 뒤 실행합니다.

```sh
cd stulooma
npm ci
npm run dev:desktop
```

상세 개발·클라우드 실행 절차는 [앱 README](stulooma/README.md)를 참고하세요. Linux 컨테이너 시험의 sandbox 예외와 대상 OS 검증 범위는 [배포 문서](stulooma/docs/RELEASE.md)에 기록했습니다.

이 앱 자체는 현재 `UNLICENSED`이며 서드파티 라이선스가 앱 전체의 재배포 권한을 부여하지 않습니다.
