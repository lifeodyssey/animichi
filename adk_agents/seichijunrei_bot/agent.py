"""
Seichijunrei Bot - ADK Agent Entry Point

This module defines the root ADK agent for the Seichijunrei (anime pilgrimage)
planning bot. It exposes a Gemini-powered LlmAgent that orchestrates the
multi-agent workflows for:

- Stage 1: extracting user intent and searching Bangumi for candidates
- Stage 2: interpreting the user's selection, fetching pilgrimage points
  from Anitabi, selecting the best points, and generating a route plan
"""

import os

from google.adk.agents import LlmAgent
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool

from config import get_settings
from utils.logger import get_logger, setup_logging

from ._workflows.bangumi_search_workflow import bangumi_search_workflow
from ._workflows.route_planning_workflow import route_planning_workflow
from .tools import (
    get_anitabi_points,
    get_bangumi_subject,
    search_anitabi_bangumi_near_station,
    search_bangumi_subjects,
)

# Initialize logging when module is loaded
setup_logging()
logger = get_logger(__name__)

# Log startup information
settings = get_settings()
logger.info(
    "Seichijunrei Bot initialized",
    adk_version="2.0",
    python_path=os.getcwd(),
    debug_mode=settings.debug,
    log_level=settings.log_level,
)

# Configure persistent session storage for multi-invocation conversations.
session_service = InMemorySessionService()

# === ADK Tools Definition ===
# (Bangumi & Anitabi query functions are imported from the local tools module)

# ADK Best Practice: Use SequentialAgent directly as root agent instead of wrapping it in AgentTool
# This ensures proper state propagation between sub-agents in the workflow.
# The old approach (wrapping as AgentTool) caused state isolation issues where
# sub-agent outputs were not accessible to downstream agents.

# Bangumi and Anitabi query tools
search_bangumi_tool = FunctionTool(search_bangumi_subjects)
get_bangumi_tool = FunctionTool(get_bangumi_subject)
get_anitabi_points_tool = FunctionTool(get_anitabi_points)
search_anitabi_bangumi_tool = FunctionTool(search_anitabi_bangumi_near_station)

# Root LlmAgent with conditional routing between Stage 1 and Stage 2 workflows.
# Name is kept as 'seichijunrei_bot' to match ADK Web app_name configuration.
root_agent = LlmAgent(
    name="seichijunrei_bot",
    model="gemini-2.0-flash",
    instruction="""
    You are a ROUTER for the Seichijunrei Bot, a 聖地巡礼 (anime location pilgrimage) planning assistant.

    Your ONLY job is to examine session state and call the appropriate workflow IMMEDIATELY without any explanation.

    CRITICAL RULES (NEVER VIOLATE):
    1. NEVER announce what you're about to do
    2. NEVER wait for user confirmation
    3. NEVER generate your own explanatory text
    4. ALWAYS execute workflows immediately and silently
    5. ONLY return the final workflow output to the user

    Decision logic based on session state:

    - If there is no 'bangumi_candidates' in the state:
        → IMMEDIATELY call BangumiSearchWorkflow (bangumi_search_workflow)
        → This workflow will:
          * Extract the bangumi name and user location
          * Search for 3-5 matching anime candidates
          * Present the candidates to the user in their language
          * The presentation agent will handle all user communication

    - If 'bangumi_candidates' exists in the state:
        → IMMEDIATELY call RoutePlanningWorkflow (route_planning_workflow)
        → This workflow will:
          * UserSelectionAgent parses the user's selection (e.g., "1", "first season")
          * PointsSearchAgent fetches all 聖地巡礼 points from Anitabi
          * PointsSelectionAgent selects 8-12 optimal points using LLM reasoning
          * RoutePlanningAgent generates a structured route plan
          * RoutePresentationAgent presents the route in the user's language

    Your role is PURE ROUTING - check state, call workflow, return output.
    All user interaction is handled by the workflows' presentation agents.
    """,
    sub_agents=[
        bangumi_search_workflow,
        route_planning_workflow,
    ],
)


# Entry point for ADK CLI
if __name__ == "__main__":
    # This allows running with `adk run agent.py`
    pass
