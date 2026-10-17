# 공식 자료 조사 기록

확인일: **2026-10-18 (Asia/Seoul)**. 공개 규격과 범용 라이브러리의 공식 기술 문서만 조사했다. 경쟁 의류 소프트웨어의 구현 코드, 바이너리, 모델 파일은 읽거나 가져오지 않았다.

## 접속 결과와 사용 범위

이 실행 환경에서 아래 공식 웹사이트의 HTTPS 요청은 모두 프록시 단계의 `Tunnel connection failed: 403 Forbidden`으로 차단됐다. 해당 웹페이지 본문을 읽었다고 주장하지 않는다. 아래에 명시한 공식 GitHub 저장소의 문서 원본은 TLS 검증을 유지한 HTTPS로 받아 내용을 확인했다. GitHub 문서 원본을 읽는 것은 경쟁 애플리케이션 코드를 참조하는 작업과 다르다.

| ID | 공식 문서 / 원래 URL | 실제 확인 자료 | 확인 결과 / 설계에 사용한 내용 |
|---|---|---|---|
| SRC-001 | [CLO 공식 도움말](https://support.clo3d.com/) | 없음 | **차단**. 사용자 기능 근거로 사용하지 않음. 사용자 제공 요구사항에서 작업 흐름 도출 |
| SRC-002 | [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) | [KhronosGroup 공식 원본](https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/2.0/Specification.adoc) | HTTP 200. GLB 헤더/청크, accessor, POSITION/NORMAL/TEXCOORD_0, URI, PBR 정의 확인 |
| SRC-003 | [W3C SVG 2](https://www.w3.org/TR/SVG2/) | [구조](https://raw.githubusercontent.com/w3c/svgwg/main/master/struct.bs), [처리·보안 모드](https://raw.githubusercontent.com/w3c/svgwg/main/master/conform.bs) | 각 HTTP 200. 스크립트·외부 참조가 가능한 문서 형식임을 확인; 현재 편집기는 SVG 가져오기 비활성 |
| SRC-004 | [W3C PNG 3](https://www.w3.org/TR/png-3/) | [W3C Third-Edition 태그](https://raw.githubusercontent.com/w3c/PNG-spec/Third-Edition/index.html) | HTTP 200. 8바이트 signature, IHDR 크기, CRC, 알파 확인. `main`은 Fourth Edition이므로 제3판 근거로 사용하지 않음 |
| SRC-005 | [Electron 문서](https://www.electronjs.org/docs/latest/), [Security](https://www.electronjs.org/docs/latest/tutorial/security) | [Electron 공식 security.md](https://raw.githubusercontent.com/electron/electron/v44.9.0/docs/tutorial/security.md) | HTTP 200, 설치된 Electron 44.9.0 태그. contextIsolation, sandbox, Node 차단, IPC 발신자 검증, CSP, 외부 탐색 제한 확인 |
| SRC-006 | [Three.js](https://threejs.org/docs/) | [GLTFLoader](https://raw.githubusercontent.com/mrdoob/three.js/r186/docs/pages/GLTFLoader.html), [GLTFExporter](https://raw.githubusercontent.com/mrdoob/three.js/r186/docs/pages/GLTFExporter.html), [CanvasTexture](https://raw.githubusercontent.com/mrdoob/three.js/r186/docs/pages/CanvasTexture.html) | 각 HTTP 200, 설치 버전 대응 r186 문서. ArrayBuffer parseAsync, binary export, CanvasTexture 갱신 및 자원 해제 범위 확인 |
| SRC-007 | [React](https://react.dev/) | [React 공식 Quick Start](https://raw.githubusercontent.com/reactjs/react.dev/main/src/content/learn/index.md) | HTTP 200. 상태 기반 UI와 이벤트 갱신 흐름 확인 |
| SRC-008 | [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction) | [pmndrs 공식 Introduction](https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/docs/getting-started/introduction.mdx) | HTTP 200. Fiber 8 ↔ React 18, Fiber 9 ↔ React 19 대응 확인. 이 프로젝트는 React 19 / Fiber 9 |

일부 공식 GitHub 파일 경로의 첫 요청은 404였다. SVG의 `.html` 경로는 현재 `.bs` 원본으로, Three.js의 이전 `docs/api` 경로는 `docs/pages`로 수정해서 확인했다. W3C PNG는 실제 공개 `Third-Edition` 태그를 `git ls-remote`로 확인한 후 사용했다. `api.github.com`도 프록시 403으로 접근되지 않았다.

## 근거의 한계

- 문서는 동작과 공개 형식을 이해하기 위한 자료다. 소프트웨어 전체 규격 준수나 보안 인증을 뜻하지 않는다.
- glTF 2.0 전체 기능, 모든 확장, 외부 glTF 리소스를 지원한다고 주장하지 않는다. P0 가져오기는 제한된 자체 포함 GLB만 대상으로 한다.
- CLO 내부 형식이나 독점 프로젝트 형식 호환성은 조사·구현하지 않았다. `.stulooma`는 독립 ZIP/JSON 형식이다.
- 문서 원문을 제품에 재배포하지 않았다. 라이브러리 라이선스와 배포 고지는 [LICENSES.md](LICENSES.md)에 별도로 기록한다.
- 공식 사이트 직접 본문 확인과 Windows/macOS 호환성은 이후 해당 접근·실행 환경에서 재검증해야 한다.
