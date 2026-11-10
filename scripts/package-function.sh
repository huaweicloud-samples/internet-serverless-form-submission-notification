#!/usr/bin/env bash
# Bundle the function source and its runtime dependencies into a zip that
# FunctionGraph can consume directly. Output: build/submit-form.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNC_DIR="$ROOT/src/functions/submit-form"
BUILD_DIR="$ROOT/build"
ZIP_FILE="$BUILD_DIR/submit-form.zip"

command -v npm >/dev/null 2>&1 || { echo "npm not found" >&2; exit 1; }
command -v python >/dev/null 2>&1 || { echo "python not found" >&2; exit 1; }

echo "[1/3] Installing runtime dependencies into the function directory"
(cd "$FUNC_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

echo "[2/3] Writing index.js / helpers / package.json / node_modules into the archive"
mkdir -p "$BUILD_DIR"
python - "$FUNC_DIR" "$ZIP_FILE" <<'PY'
import os
import sys
import zipfile

func_dir, zip_path = sys.argv[1], sys.argv[2]
skip_dirs = {'.git', '__pycache__', '.terraform'}
if os.path.exists(zip_path):
    os.remove(zip_path)

count = 0
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for base, dirs, files in os.walk(func_dir):
        dirs[:] = sorted(d for d in dirs if d not in skip_dirs)
        for name in sorted(files):
            full = os.path.join(base, name)
            if name.endswith(('.log', '.tmp', '.zip')):
                continue
            arc = os.path.relpath(full, func_dir).replace(os.sep, '/')
            zf.write(full, arc)
            count += 1
print('  files=%d' % count)
PY

echo "[3/3] Done"
ls -lh "$ZIP_FILE"
echo "ZIP=$ZIP_FILE"
