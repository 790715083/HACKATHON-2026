#!/bin/sh
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
exec "$PROJECT_DIR/start.sh" "$@"
