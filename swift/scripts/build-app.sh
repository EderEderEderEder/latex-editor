#!/bin/bash
# Baut LatexEditor.app (Universal: arm64 + x86_64) aus dem Swift Package.
# Aufruf: scripts/build-app.sh   ->   build/LatexEditor.app
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="LatexEditor"
BUNDLE_ID="de.maxieder.LatexEditor"
VERSION="0.1.0"
MIN_MACOS="15.0"
ARCHS=(arm64 x86_64)

# Stand für „Über LatexEditor“: Commit und Build-Zeit (unversionierte Dateien zählen nicht als Änderung)
GIT="/usr/local/bin/git"
[[ -x "${GIT}" ]] || GIT="$(xcode-select -p)/usr/bin/git"
BUILD_COMMIT="$(GIT_OPTIONAL_LOCKS=0 "${GIT}" rev-parse --short HEAD 2>/dev/null || echo "unbekannt")"
if [[ -n "$(GIT_OPTIONAL_LOCKS=0 "${GIT}" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
    BUILD_COMMIT="${BUILD_COMMIT} + lokale Änderungen"
fi
BUILD_DATE="$(date "+%d.%m.%Y %H:%M")"
# Muss eine Zahl sein und mit jedem Build steigen
BUILD_NUMBER="$(date "+%Y%m%d%H%M")"

APP_DIR="build/${APP_NAME}.app"
BINARY_PARTS=()

for arch in "${ARCHS[@]}"; do
    echo "==> Baue ${arch}"
    swift build -c release --arch "${arch}" --scratch-path ".build-${arch}"
    bin_dir="$(swift build -c release --arch "${arch}" --scratch-path ".build-${arch}" --show-bin-path)"
    BINARY_PARTS+=("${bin_dir}/${APP_NAME}")
done

echo "==> Erzeuge ${APP_DIR}"
rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources"
lipo -create "${BINARY_PARTS[@]}" -output "${APP_DIR}/Contents/MacOS/${APP_NAME}"

# App-Icon: Resources/AppIcon.png (quadratisch, mit Transparenz) -> AppIcon.icns
ICON_SOURCE="Resources/AppIcon.png"
if [[ -f "${ICON_SOURCE}" ]]; then
    ICONSET="$(mktemp -d)/AppIcon.iconset"
    mkdir -p "${ICONSET}"
    for size in 16 32 128 256 512; do
        sips -z "${size}" "${size}" "${ICON_SOURCE}" --out "${ICONSET}/icon_${size}x${size}.png" >/dev/null
        sips -z "$((size * 2))" "$((size * 2))" "${ICON_SOURCE}" --out "${ICONSET}/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "${ICONSET}" -o "${APP_DIR}/Contents/Resources/AppIcon.icns"
    rm -rf "$(dirname "${ICONSET}")"
fi

cat > "${APP_DIR}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>de</string>
    <key>CFBundleExecutable</key><string>${APP_NAME}</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleName</key><string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${VERSION}</string>
    <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
    <key>NSHumanReadableCopyright</key><string>Stand: Commit ${BUILD_COMMIT} vom ${BUILD_DATE}</string>
    <key>LSMinimumSystemVersion</key><string>${MIN_MACOS}</string>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSSupportsAutomaticTermination</key><false/>
    <key>NSSupportsSuddenTermination</key><false/>
</dict>
</plist>
PLIST

echo "==> Signiere ad-hoc"
codesign --force --deep --sign - "${APP_DIR}"

echo "==> Fertig: ${APP_DIR} (Commit ${BUILD_COMMIT}, ${BUILD_DATE})"
lipo -archs "${APP_DIR}/Contents/MacOS/${APP_NAME}"
