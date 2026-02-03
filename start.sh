#!/bin/bash
# =============================================================================
# Mission Control Launcher
# =============================================================================
# Starts the backend server and launches the Mac app together.
#
# Usage:
#   ./start.sh           # Start backend + open app (app must be pre-built)
#   ./start.sh --build   # Build app first, then start
#   ./start.sh --web     # Start backend only (use browser at localhost:3000)
#
# =============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_PATH="$SCRIPT_DIR/apps/mission-control-mac/build/Release/MissionControl.app"
BACKEND_DIR="$SCRIPT_DIR/apps/mission-control"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║       Mission Control Launcher        ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Parse arguments
BUILD_FIRST=false
WEB_ONLY=false

for arg in "$@"; do
  case $arg in
    --build)
      BUILD_FIRST=true
      ;;
    --web)
      WEB_ONLY=true
      ;;
    --help|-h)
      echo "Usage: ./start.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --build    Build the Mac app before starting"
      echo "  --web      Start backend only (no Mac app, use browser)"
      echo "  --help     Show this help message"
      echo ""
      exit 0
      ;;
  esac
done

# Build if requested
if [[ "$BUILD_FIRST" == "true" ]]; then
  echo -e "${YELLOW}Building Mac app...${NC}"
  cd "$SCRIPT_DIR/apps/mission-control-mac"
  ./build.sh Release
  cd "$SCRIPT_DIR"
  echo -e "${GREEN}Build complete!${NC}"
  echo ""
fi

# Check if app exists (unless web-only mode)
if [[ "$WEB_ONLY" == "false" ]] && [[ ! -d "$APP_PATH" ]]; then
  echo -e "${RED}Mac app not found at:${NC}"
  echo "  $APP_PATH"
  echo ""
  echo "Options:"
  echo "  1. Build the app:  ./start.sh --build"
  echo "  2. Use web mode:   ./start.sh --web"
  echo "  3. Use browser:    npm run dev"
  echo ""
  exit 1
fi

# Check if backend dependencies are installed
if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  cd "$SCRIPT_DIR"
  npm install
fi

# Check if database exists
if [[ ! -f "$SCRIPT_DIR/data/mission-control.db" ]]; then
  echo -e "${YELLOW}Initializing database...${NC}"
  cd "$BACKEND_DIR"
  npm run db:migrate
fi

# Start backend
echo -e "${YELLOW}Starting backend server...${NC}"
cd "$BACKEND_DIR"
npm run start &
BACKEND_PID=$!

# Cleanup function
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  kill $BACKEND_PID 2>/dev/null || true
  echo -e "${GREEN}Mission Control stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Wait for backend to be ready
echo "Waiting for backend..."
READY=false
for i in {1..30}; do
  if curl -s http://127.0.0.1:3000/api/maintenance > /dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 1
  echo -n "."
done
echo ""

if [[ "$READY" != "true" ]]; then
  echo -e "${RED}Backend failed to start within 30 seconds.${NC}"
  echo "Check the logs above for errors."
  exit 1
fi

echo -e "${GREEN}Backend ready at http://127.0.0.1:3000${NC}"

# Launch app or show browser instructions
if [[ "$WEB_ONLY" == "true" ]]; then
  echo ""
  echo -e "${GREEN}Mission Control is running!${NC}"
  echo "Open http://localhost:3000 in your browser."
  echo ""
  echo "Press Ctrl+C to stop."
else
  echo ""
  echo -e "${YELLOW}Launching Mac app...${NC}"
  open "$APP_PATH"
  echo -e "${GREEN}Mission Control is running!${NC}"
  echo ""
  echo "Press Ctrl+C to stop."
fi

# Keep script running (wait for backend process)
wait $BACKEND_PID
