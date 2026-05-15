#!/usr/bin/env bash
# poc-06-frost-engine-middleware build
#
# Compiles a single WASM module that exposes two ABIs side-by-side:
#   - engine_*                       (frost orchestration: entity table + Lua)
#   - nuna_middleware_*              (ADR-029 every-frame compute)
#
# XML parsing happens in JS now — the wasm has no XML deps. The wasm
# accepts Lua source as strings via engine_attach_script(), so assets
# are fetched by the JS layer and uploaded.

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f vendor/nuna-middleware/src/middleware.cpp ]; then
  echo "submodule not initialised — run:" >&2
  echo "  git submodule update --init --recursive" >&2
  exit 1
fi

LUA_VERSION=5.4.7
VENDOR=vendor
LUA_SRC="$VENDOR/lua-$LUA_VERSION/src"
MIDDLEWARE_DIR="$VENDOR/nuna-middleware"

mkdir -p "$VENDOR" web

if [ ! -d "$LUA_SRC" ]; then
  echo "fetching Lua $LUA_VERSION..."
  curl -fsSL "https://www.lua.org/ftp/lua-$LUA_VERSION.tar.gz" -o "$VENDOR/lua.tar.gz"
  tar -xzf "$VENDOR/lua.tar.gz" -C "$VENDOR"
  rm "$VENDOR/lua.tar.gz"
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
  _engine_add_entity
  _engine_set_position
  _engine_set_scale
  _engine_set_color
  _engine_set_property
  _engine_attach_script
  _engine_tick
  _engine_get_entity_count
  _engine_get_entity_id
  _engine_get_entity_x
  _engine_get_entity_y
  _engine_get_entity_z
  _engine_get_entity_scale_x
  _engine_get_entity_scale_y
  _engine_get_entity_scale_z
  _engine_get_entity_color
  _nuna_middleware_produce_frame_flat
  _nuna_middleware_version
  _malloc
  _free
)
EXPORTS_JOINED=$(IFS=,; echo "${EXPORTS[*]}")

echo "compiling..."
emcc -O2 -std=c++17 \
  -I"$LUA_SRC" -I"$MIDDLEWARE_DIR/include" \
  src/engine.cpp \
  "$MIDDLEWARE_DIR/src/middleware.cpp" \
  "${LUA_SRCS[@]}" \
  -o web/engine.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,HEAPF32 \
  -sEXPORTED_FUNCTIONS="$EXPORTS_JOINED"

echo "built: web/engine.mjs, web/engine.wasm"
echo "serve: python3 -m http.server -d web 8080"
