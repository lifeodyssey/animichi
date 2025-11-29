#!/bin/bash
# Start ADK Web for Seichijunrei Bot
# This script ensures the correct agent is loaded and provides helpful startup info

set -e

echo "========================================="
echo "  Seichijunrei Bot - ADK Web Launcher"
echo "========================================="
echo ""
echo "Starting ADK Web server..."
echo "Agent: seichijunrei_bot"
echo "Directory: adk_agents"
echo ""
echo "Once started, access the web interface at:"
echo "  http://localhost:8000/?app_name=seichijunrei_bot"
echo ""
echo "Press Ctrl+C to stop the server"
echo "========================================="
echo ""

# Use a project-local cache directory for uv to avoid permission issues
export UV_CACHE_DIR="${UV_CACHE_DIR:-"$(pwd)/.uv_cache"}"

# Start ADK Web for all agents in the adk_agents directory
uv run adk web adk_agents
