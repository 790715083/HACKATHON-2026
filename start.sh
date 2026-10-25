#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_DIR"
# Finder-launched terminals may not include Homebrew's standard locations.
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PATH

if ! command -v node >/dev/null 2>&1; then
  printf '请先安装 Node.js 22+，然后重新运行启动脚本。\n' >&2
  exit 1
fi

exec node scripts/start-local.mjs "$@"
