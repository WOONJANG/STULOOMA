# STULOOMA 0.3.0 개발판 배포

[0.3.0 릴리스](https://github.com/WOONJANG/STULOOMA/releases/tag/v0.3.0-dev)의 본문에서 Windows 실행 ZIP·소스 ZIP·SHA256SUMS를 받을 수 있다. ZIP 전체를 풀고 `STULOOMA-win32-x64/STULOOMA.exe`를 실행한다. 이전 버전과 다른 폴더에 풀어 사용한다. 기존 `.stulooma` 프로젝트를 열 수 있다.

- Windows 직접 링크: https://media.githubusercontent.com/media/WOONJANG/STULOOMA/downloads-v0.3.0-dev/STULOOMA-Windows-0.3.0.zip
- Linux 직접 링크: https://media.githubusercontent.com/media/WOONJANG/STULOOMA/downloads-v0.3.0-dev/STULOOMA-Linux-0.3.0.zip
- 소스 직접 링크: https://raw.githubusercontent.com/WOONJANG/STULOOMA/downloads-v0.3.0-dev/STULOOMA-source-0.3.0.zip
- 무결성: https://raw.githubusercontent.com/WOONJANG/STULOOMA/downloads-v0.3.0-dev/SHA256SUMS.txt

GitHub 릴리스 본문에 실제 다운로드 링크를 제공한다. Windows/Linux 실행 ZIP은 Git LFS의 공개 다운로드 호스트에서 제공하며 Git의 작은 LFS 포인터 파일을 실행 ZIP으로 제시하지 않는다. 소스는 일반 Git blob이다. 게시 전 로그인 없는 전체 다운로드와 SHA-256 일치를 검사한다.

서명되지 않은 개발판이다. Linux에서 실제 Electron 실행을 검증하며 Windows ZIP 제작·내용 검증과 Windows 네이티브 실행은 구분한다. macOS 앱은 제공하지 않는다. 새 결과는 [VECTOR_RESULTS.md](VECTOR_RESULTS.md), 패키지 크기와 해시는 [ARTIFACTS.json](ARTIFACTS.json), 남은 사항은 [GAPS.md](GAPS.md)를 따른다.

소스 ZIP은 `python3 scripts/package-source.py`로 현재 Git 추적 파일과 무시되지 않은 새 소스를 묶는다. `.git`, 설치 의존성, 빌드 결과, 로컬 설정·캐시를 제외하고 ZIP CRC를 검사한다.

## 이전 버전의 재현 환경과 기록

아래는 0.1.0 패키지를 만들 때의 환경과 절차다. 새 버전도 같은 lockfile·Electron 다운로드 체크섬·sandbox/CSP 보안 경계를 사용한다.

# STULOOMA desktop builds

Requires Node.js 24 LTS, npm, and an operating system supported by the pinned Electron version. Install with `npm ci` from `stulooma/`. Dependencies and Electron releases retain TLS and checksum validation. In a managed proxy environment with Node 24, `NODE_USE_ENV_PROXY=1` lets Electron's downloader use the existing proxy configuration. Use `electron_config_cache=/workspace/.cache/electron` when the home directory is read-only.

## Run

`npm run dev:desktop` bundles the Electron main process and sandboxed preload, starts Vite on `127.0.0.1:5173`, waits for it, then opens the desktop application. Main/preload changes require restarting this command. `npm run dev` runs the browser development experience. For the packaged renderer locally, run `npm run build` then `npx electron .`.

The renderer has no Node integration. Only opening a `.stulooma` project and saving project/PNG/JPEG/GLB/SVG bytes are exposed through the preload bridge. File paths stay in the main process; dialogs require a trusted top-level renderer. Projects are limited to 64 MiB; other exports to 128 MiB. Saving writes and syncs a private temporary file beside the destination before an atomic rename. The app blocks outbound network, new windows, navigation, webviews, downloads, and permission requests. Development allows only its local Vite origin.

## Verify

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. With a display available, run `npm run test:desktop` for a real Electron launch and native file bridge checks. The desktop test stubs native file dialog choices, validates files written to a temporary directory, checks the sandboxed bridge, and verifies outbound traffic and new windows are blocked.

To test the actual packaged Linux executable through the same suite, set `STULOOMA_TEST_EXECUTABLE` to the absolute path of `out/STULOOMA-linux-x64/STULOOMA`. The suite also opens a project passed as a startup argument after the renderer signals readiness. This checks the command-line delivery flow; native OS association registration still requires target-OS testing.

Linux CI needs an X server, such as Xvfb. Start it with `Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp`, set `DISPLAY=:99`, and run the desktop test. Restricted containers may disable user namespaces and cannot configure Chromium's root-owned SUID sandbox. For testing only in that isolated container, `STULOOMA_CI_NO_SANDBOX=1 npm run test:desktop` adds `--no-sandbox` to the test launch. Normal startup and distributed builds never set that switch. Such a CI run validates the renderer's isolation settings and IPC, but does not prove the Linux OS sandbox operates on a user's machine.

For the supplied Debian trixie cloud image with a read-only home, `bash scripts/setup-cloud-display.sh --start` downloads Xvfb/libXfont2 using signed Debian package indexes and extracts them under `/workspace/.cache/system`; it makes no root/system installation. It starts its own display or reuses the matching local Xvfb process. Then run `source /workspace/.cache/system/display.env` before the desktop test. `--install-only` prepares the files without starting a display. `STULOOMA_CLOUD_CACHE` and `STULOOMA_CLOUD_DISPLAY` select another absolute cache directory or display number. No XKB override is required on this image.

## Package

- Linux x64: `npm run package:linux` → `out/make/zip/linux/x64/`.
- Windows x64 portable ZIP: `npm run package:win` → `out/make/zip/win32/x64/`.

These commands build the renderer/main/preload and package with Electron Forge. Packaging Windows ZIPs on Linux does not need Wine. A ZIP contains the application runtime and launches through `STULOOMA.exe` on Windows or `STULOOMA` on Linux. Test each archive on its target OS; producing a Windows ZIP on Linux does not verify Windows behavior. Generated artifacts are unsigned development builds. Public commercial distribution requires a release owner, Windows signing and reputation handling, target-OS smoke tests, legal/license review, security review, and a supported update/distribution process.

Portable ZIP extraction does not register a Windows/Linux file association. Users can open files through the application or use the OS's “Open with” selection. The packaging configuration includes macOS document-type declarations, but macOS packaging and notarization are outside this Linux/Windows development release. macOS `open-file` and Windows/Linux second-instance file arguments are queued in the main process and delivered through the same validated open bridge. Native association behavior has not been verified on Windows/macOS.

## 이번 산출물 검증

최종 Linux 패키지 자체의 Electron 검사 결과는 [VECTOR_RESULTS.md](VECTOR_RESULTS.md)에 기록한다. Windows 실행 파일은 생성·PE 형식·ZIP CRC·현재 번들/고지 일치만 검증했다. 두 ZIP의 실제 크기와 SHA-256은 [ARTIFACTS.json](ARTIFACTS.json), 상세 결과는 [VECTOR_RESULTS.md](VECTOR_RESULTS.md)를 따른다. 배포되는 코드와 Electron main/preload를 현재 `dist`와 바이트 해시로 대조했고, renderer에 포함된 19종 라이브러리와 내장 하위 코드·글꼴 고지를 보존했다.
