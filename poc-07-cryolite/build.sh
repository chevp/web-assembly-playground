#!/usr/bin/env bash
# poc-07-frost-engine-threejs-lib build
#
# Produces the npm package's wasm artifacts under lib/:
#   - lib/engine.mjs    Emscripten glue (ES module)
#   - lib/engine.wasm   the wasm binary itself
#   - lib/engine.data   preloaded /assets payload
#
# The .mjs file is built with default ENVIRONMENT (web+node), so the
# same artifact is consumable from both a browser and a node script.

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f vendor/nuna-middleware/src/middleware.cpp ]; then
  echo "submodule not initialised — run:" >&2
  echo "  git submodule update --init --recursive" >&2
  exit 1
fi

LUA_VERSION=5.4.7
TINYXML2_VERSION=10.0.0
VENDOR=vendor
LUA_SRC="$VENDOR/lua-$LUA_VERSION/src"
TINYXML2_DIR="$VENDOR/tinyxml2-$TINYXML2_VERSION"
MIDDLEWARE_DIR="$VENDOR/nuna-middleware"

mkdir -p "$VENDOR" lib

if [ ! -d "$LUA_SRC" ]; then
  echo "fetching Lua $LUA_VERSION..."
  curl -fsSL "https://www.lua.org/ftp/lua-$LUA_VERSION.tar.gz" -o "$VENDOR/lua.tar.gz"
  tar -xzf "$VENDOR/lua.tar.gz" -C "$VENDOR"
  rm "$VENDOR/lua.tar.gz"
fi

if [ ! -f "$TINYXML2_DIR/tinyxml2.cpp" ]; then
  echo "fetching tinyxml2 $TINYXML2_VERSION..."
  mkdir -p "$TINYXML2_DIR"
  curl -fsSL "https://raw.githubusercontent.com/leethomason/tinyxml2/$TINYXML2_VERSION/tinyxml2.h"   -o "$TINYXML2_DIR/tinyxml2.h"
  curl -fsSL "https://raw.githubusercontent.com/leethomason/tinyxml2/$TINYXML2_VERSION/tinyxml2.cpp" -o "$TINYXML2_DIR/tinyxml2.cpp"
fi

LUA_SRCS=()
for f in "$LUA_SRC"/*.c; do
  case "$(basename "$f")" in
    lua.c|luac.c|onelua.c|ltests.c) ;;
    *) LUA_SRCS+=("$f") ;;
  esac
done

EXPORTS=(
  _engine_init
  _engine_tick
  _engine_get_entity_count
  _engine_get_entity_id
  _engine_get_entity_x
  _engine_get_entity_y
  _engine_get_entity_size
  _engine_get_entity_color
  _nuna_middleware_produce_frame_flat
  _nuna_middleware_version
  _malloc
  _free
)
EXPORTS_JOINED=$(IFS=,; echo "${EXPORTS[*]}")

echo "compiling..."
emcc -O2 -std=c++17 \
  -I"$LUA_SRC" -I"$TINYXML2_DIR" -I"$MIDDLEWARE_DIR/include" \
  src/engine.cpp \
  "$MIDDLEWARE_DIR/src/middleware.cpp" \
  "$TINYXML2_DIR/tinyxml2.cpp" \
  "${LUA_SRCS[@]}" \
  -o lib/engine.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPF32 \
  -sEXPORTED_FUNCTIONS="$EXPORTS_JOINED" \
  --preload-file src/assets@/assets

echo "built: lib/engine.mjs, lib/engine.wasm, lib/engine.data"
