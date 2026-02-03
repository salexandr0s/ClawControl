#!/bin/bash
# =============================================================================
# Mission Control Stop Script
# =============================================================================
# Stops all Mission Control processes (backend and Mac app).
# =============================================================================

echo "Stopping Mission Control..."

# Stop Next.js backend
pkill -f "next start" 2>/dev/null && echo "  ✓ Backend stopped" || echo "  - Backend not running"

# Stop Mac app
pkill -f "MissionControl.app" 2>/dev/null && echo "  ✓ Mac app stopped" || echo "  - Mac app not running"

echo ""
echo "Mission Control stopped."
