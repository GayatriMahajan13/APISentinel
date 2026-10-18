#!/bin/zsh
set -e
cd "$(dirname "$0")"
export DYLD_LIBRARY_PATH="$PWD/vendor/libomp:${DYLD_LIBRARY_PATH:-}"
cd backend
exec python3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
