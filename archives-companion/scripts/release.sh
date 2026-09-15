#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
OUT="$ROOT/release/0.2"
mkdir -p "$OUT"
node scripts/prepare-release.mjs > "$OUT/prepare.log" 2>&1
(cd ArchivesCore && swift test) > "$OUT/tests.log" 2>&1
xcodegen generate > "$OUT/xcodegen.log" 2>&1
xcodebuild -project ArchivesCompanion.xcodeproj -scheme ArchivesiOS -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Archives-0.2.xcarchive" \
  -derivedDataPath "$OUT/DerivedData" -allowProvisioningUpdates DEVELOPMENT_TEAM=X429L5AGXB \
  archive > "$OUT/archive.log" 2>&1
xcodebuild -exportArchive -archivePath "$OUT/Archives-0.2.xcarchive" \
  -exportPath "$OUT/export" -exportOptionsPlist ExportOptions.plist \
  -allowProvisioningUpdates > "$OUT/export.log" 2>&1
xcodebuild -project ArchivesCompanion.xcodeproj -scheme ArchivesSyncHelper -configuration Release \
  -destination 'platform=macOS' -derivedDataPath "$OUT/DerivedData" DEVELOPMENT_TEAM=X429L5AGXB \
  build > "$OUT/helper.log" 2>&1
HELPER="$OUT/DerivedData/Build/Products/Release/ArchivesSyncHelper.app"
codesign --verify --deep --strict "$HELPER"
node scripts/verify-bundle.mjs "$OUT/Archives-0.2.xcarchive/Products/Applications/ArchivesiOS.app"
ditto -c -k --sequesterRsrc --keepParent "$HELPER" "$OUT/ArchivesSyncHelper-0.2.zip"
cp README.md "$OUT/SETUP.md"
shasum -a 256 "$OUT/export/ArchivesiOS.ipa" "$OUT/ArchivesSyncHelper-0.2.zip" > "$OUT/SHA256SUMS"
if [[ "${1:-}" == "--upload" ]]; then
  python3 - "$OUT/UploadOptions.plist" <<'PY'
import plistlib,sys
with open('ExportOptions.plist','rb') as f: options=plistlib.load(f)
options['destination']='upload'
with open(sys.argv[1],'wb') as f: plistlib.dump(options,f)
PY
  xcodebuild -exportArchive -archivePath "$OUT/Archives-0.2.xcarchive" \
    -exportPath "$OUT/upload" -exportOptionsPlist "$OUT/UploadOptions.plist" \
    -allowProvisioningUpdates > "$OUT/upload.log" 2>&1
fi
printf 'Release artifacts: %s\n' "$OUT"
