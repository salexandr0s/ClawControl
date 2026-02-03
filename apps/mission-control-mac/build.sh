#!/bin/bash
set -e
cd "$(dirname "$0")"

CONFIG="${1:-Release}"

echo "Building MissionControl ($CONFIG)..."
xcodebuild -project MissionControl.xcodeproj \
  -scheme MissionControl \
  -configuration "$CONFIG" \
  build \
  | grep -E "^(Build|Compiling|Linking|\*\*)" || true

echo ""
echo "Built: build/$CONFIG/MissionControl.app"
echo "Run:   open build/$CONFIG/MissionControl.app"
