#!/usr/bin/env bash
# Optional headless desktop-test prerequisite. No root/system installation or sandbox changes.
set -euo pipefail

cloud_cache="${STULOOMA_CLOUD_CACHE:-/workspace/.cache}"
case "$cloud_cache" in /*) ;; *) printf '%s\n' 'STULOOMA_CLOUD_CACHE must be an absolute path' >&2; exit 1;; esac
display_number="${STULOOMA_CLOUD_DISPLAY:-99}"
[[ "$display_number" =~ ^[0-9]{1,3}$ ]] || { printf '%s\n' 'Display number must contain 1–3 digits' >&2; exit 1; }
system_cache="$cloud_cache/system"
extract_root="$system_cache/root"
xvfb_binary="$extract_root/usr/bin/Xvfb"
apt_root="$system_cache/apt"
mkdir -p "$system_cache"

if [[ ! -x "$xvfb_binary" || ! -f "$extract_root/usr/lib/x86_64-linux-gnu/libXfont2.so.2" ]]; then
  . /etc/os-release
  [[ "${ID:-}" == debian && "${VERSION_CODENAME:-}" == trixie ]] || {
    printf '%s\n' 'Automatic local Xvfb installation supports this Debian trixie cloud image only.' >&2; exit 1;
  }
  mkdir -p "$apt_root/lists/partial" "$apt_root/archives/partial" "$apt_root/empty" "$system_cache/packages"
  cat > "$apt_root/sources.list" <<'SOURCES'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
SOURCES
  # APT_CONFIG is read before system snippets, avoiding machine-wide cache cleanup hooks.
  cat > "$apt_root/apt.conf" <<CONFIG
Dir::Etc::parts "$apt_root/empty";
Dir::Etc::main "-";
Dir::Etc::sourcelist "$apt_root/sources.list";
Dir::Etc::sourceparts "-";
Dir::State::lists "$apt_root/lists";
Dir::Cache "$apt_root";
Dir::Cache::archives "$apt_root/archives";
Dir::Cache::pkgcache "";
Dir::Cache::srcpkgcache "";
CONFIG
  APT_CONFIG="$apt_root/apt.conf" /usr/bin/apt-get update
  (
    cd "$system_cache/packages"
    # Signed package indexes supply the expected package checksums to apt-get download.
    APT_CONFIG="$apt_root/apt.conf" /usr/bin/apt-get download xvfb libxfont2
    for package in xvfb_*.deb libxfont2_*.deb; do dpkg-deb -x "$package" "$extract_root"; done
  )
fi

if LD_LIBRARY_PATH="$extract_root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$xvfb_binary" | rg -q 'not found'; then
  printf '%s\n' 'Xvfb has missing system prerequisites; inspect ldd output for this cloud image.' >&2
  exit 1
fi

cat > "$system_cache/display.env" <<ENVIRONMENT
export DISPLAY=:$display_number
export LD_LIBRARY_PATH="$extract_root/usr/lib/x86_64-linux-gnu\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
ENVIRONMENT

if [[ "${1:-}" == --install-only ]]; then
  printf 'Xvfb installed locally. Environment: %s\n' "$system_cache/display.env"
  exit 0
fi
[[ $# == 0 || "${1:-}" == --start ]] || { printf '%s\n' 'Usage: setup-cloud-display.sh [--install-only|--start]' >&2; exit 1; }

existing_pid=''
for candidate in /proc/[0-9]*; do
  [[ -r "$candidate/cmdline" ]] || continue
  mapfile -d '' -t arguments < "$candidate/cmdline" || continue
  if [[ "${arguments[0]:-}" == "$xvfb_binary" && "${arguments[1]:-}" == ":$display_number" ]]; then
    existing_pid="${candidate##*/}"
    break
  fi
done
if [[ -n "$existing_pid" ]]; then
  DISPLAY=":$display_number" xdpyinfo >/dev/null 2>&1 || {
    printf '%s\n' 'A matching Xvfb process exists but is not ready; inspect the local Xvfb log.' >&2; exit 1;
  }
  printf 'Reusing local Xvfb process %s on :%s. Environment: %s\n' "$existing_pid" "$display_number" "$system_cache/display.env"
  exit 0
fi
if DISPLAY=":$display_number" xdpyinfo >/dev/null 2>&1 || [[ -e "/tmp/.X${display_number}-lock" ]]; then
  printf 'Display :%s belongs to another X server; select STULOOMA_CLOUD_DISPLAY explicitly.\n' "$display_number" >&2
  exit 1
fi

LD_LIBRARY_PATH="$extract_root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  nohup "$xvfb_binary" ":$display_number" -screen 0 1600x1000x24 -nolisten tcp \
  > "$system_cache/xvfb-${display_number}.log" 2>&1 < /dev/null &
xvfb_pid=$!
printf '%s\n' "$xvfb_pid" > "$system_cache/xvfb-${display_number}.pid"
for attempt in {1..50}; do
  if DISPLAY=":$display_number" xdpyinfo >/dev/null 2>&1; then
    printf 'Started local Xvfb process %s on :%s. Environment: %s\n' "$xvfb_pid" "$display_number" "$system_cache/display.env"
    exit 0
  fi
  kill -0 "$xvfb_pid" 2>/dev/null || { printf '%s\n' 'Xvfb stopped; inspect the local log.' >&2; exit 1; }
  sleep 0.1
done
printf '%s\n' 'Xvfb did not become ready; inspect the local log.' >&2
exit 1
