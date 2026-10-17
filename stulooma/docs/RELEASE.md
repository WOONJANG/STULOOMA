# STULOOMA desktop builds

Requires Node.js 24 LTS, npm, and an operating system supported by the pinned Electron version. Install with `npm ci` from `stulooma/`. Dependencies and Electron releases retain TLS and checksum validation. In a managed proxy environment with Node 24, `NODE_USE_ENV_PROXY=1` lets Electron's downloader use the existing proxy configuration. Use `electron_config_cache=/workspace/.cache/electron` when the home directory is read-only.

## Run

`npm run dev:desktop` bundles the Electron main process and sandboxed preload, starts Vite on `127.0.0.1:5173`, waits for it, then opens the desktop application. Main/preload changes require restarting this command. `npm run dev` runs the browser development experience. For the packaged renderer locally, run `npm run build` then `npx electron .`.

The renderer has no Node integration. Only opening a `.stulooma` project and saving project/PNG/JPEG/GLB bytes are exposed through the preload bridge. File paths stay in the main process; dialogs require a trusted top-level renderer. Projects are limited to 64 MiB; other exports to 128 MiB. Saving writes and syncs a private temporary file beside the destination before an atomic rename. The app blocks outbound network, new windows, navigation, webviews, downloads, and permission requests. Development allows only its local Vite origin.

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

최종 Linux 패키지 자체에서 Electron 시험2개가 통과했다. Windows 실행 파일은 생성·PE 형식·ZIP CRC·현재 번들/고지 일치만 검증했다. 두 ZIP의 실제 크기와 SHA-256은 [ARTIFACTS.json](ARTIFACTS.json), 상세 결과는 [RESULTS.md](RESULTS.md)를 따른다. 배포되는 코드와 Electron main/preload를 현재 `dist`와 바이트 해시로 대조했고, renderer에 포함된16종 라이브러리/글꼴 고지를 보존했다.
