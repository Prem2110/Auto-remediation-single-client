"""
agents/verifier_agent.py
========================
VerifierAgent — post-fix verification: retry failed messages and run iFlow tests.

Uses only mcp_testing server tools so it can never accidentally call any
integration_suite write tools (update-iflow / deploy-iflow).

Exports:
  VerifierAgent
    .retry_failed_message(incident)    → {"success", "skipped", "summary", "steps"}
    .test_iflow_after_fix(incident)    → {"success", "skipped", "http_status", "summary", "steps"}
    .get_retry_tool_candidates()       → List[str]
"""

import asyncio
import json
import logging
from typing import Any, Dict, List

from agents.base import StepLogger, TestExecutionTracker
from utils.utils import get_hana_timestamp

logger = logging.getLogger(__name__)


class VerifierAgent:
    """
    Verifies that a deployed fix works by replaying the original failed message
    and/or running a test payload through the iFlow HTTP endpoint.

    Tools are restricted to mcp_testing server + any retry/replay tools from
    integration_suite (read-only).
    """

    def __init__(self, mcp):
        self._mcp          = mcp
        self._agent        = None  # set by build_agent()
        self.error_fetcher = None  # injected via set_error_fetcher()

    def set_error_fetcher(self, error_fetcher) -> None:
        """Inject the SAPErrorFetcher so check_iflow_runtime_status can poll CPI."""
        self.error_fetcher = error_fetcher

    async def build_agent(self) -> None:
        """Build a verifier agent with check_iflow_runtime_status @tool + mcp_testing tools."""
        from langchain_core.tools import tool as _tool  # noqa: PLC0415

        _fetcher = self.error_fetcher  # may be None if not injected

        @_tool
        async def check_iflow_runtime_status(iflow_id: str) -> str:
            """
            Poll SAP CPI runtime to check if an iFlow is in Started/Error state.
            Returns the current DeployState/Status of the runtime artifact.
            """
            if _fetcher is None:
                return f"Runtime fetcher not available — cannot poll status for '{iflow_id}'."
            detail = await _fetcher.fetch_runtime_artifact_detail(iflow_id)
            status = (
                detail.get("Status")
                or detail.get("DeployState")
                or detail.get("RuntimeStatus")
                or "UNKNOWN"
            )
            error_info = (
                detail.get("ErrorInformation")
                or detail.get("Description")
                or ""
            )
            if error_info:
                return f"Status={status} | ErrorInformation={str(error_info)[:300]}"
            return f"Status={status}"

        # mcp_testing tools + any retry/replay tools
        verify_tools = [
            t for t in self._mcp.tools
            if t.server == "mcp_testing"
            or any(kw in f"{t.name} {t.mcp_tool_name} {t.description}".lower()
                   for kw in ("retry", "replay", "resubmit", "test_iflow"))
        ]
        if not verify_tools:
            verify_tools = [t for t in self._mcp.tools if t.server == "mcp_testing"]

        all_tools = [check_iflow_runtime_status] + verify_tools

        system_prompt = """You are an SAP CPI post-fix verification agent.

Your job is to verify that a deployed fix works:
1. Call check_iflow_runtime_status to confirm the iFlow is in Started state.
2. Use retry/replay tools to resubmit the original failed message (if message GUID provided).
3. Use test_iflow_with_payload to send a test payload to the iFlow (if HTTP endpoint available).

Do NOT call get-iflow, update-iflow, or deploy-iflow.
Do NOT modify any iFlow.
Make at most 3 tool calls total, then return your result as JSON:
{"test_passed": true/false, "http_status": <code or null>, "summary": "..."}
"""
        self._agent = await self._mcp.build_agent(
            tools=all_tools,
            system_prompt=system_prompt,
        )
        logger.info(
            "[Verifier] Agent ready — 1 local @tool + %d mcp_testing tools.", len(verify_tools)
        )

    # ── retry candidates ────────────────────────────────────────────────────

    def get_retry_tool_candidates(self) -> List[str]:
        return [
            t.name for t in self._mcp.tools
            if any(
                tok in f"{t.name} {t.description}".lower()
                for tok in ("retry", "replay", "resubmit")
            )
        ]

    # ── retry failed message ────────────────────────────────────────────────

    async def retry_failed_message(self, incident: Dict[str, Any]) -> Dict[str, Any]:
        message_guid = incident.get("message_guid", "")
        if not message_guid:
            return {"success": False, "skipped": True, "summary": "No message GUID available for retry."}

        retry_tools = self.get_retry_tool_candidates()
        if not retry_tools:
            return {
                "success": False,
                "skipped": True,
                "summary": "No retry or replay MCP tool is currently available.",
            }

        agent = self._agent or self._mcp.agent
        if agent is None:
            return {"success": False, "skipped": True, "summary": "MCP agent not ready."}

        prompt = f"""RETRY FAILED MESSAGE — use exactly one retry or replay tool call, then stop.
Message GUID: {message_guid}
Candidate tools: {", ".join(retry_tools)}
Rules:
- Retry or replay only this failed message.
- Do not fetch logs.
- Do not modify the iFlow.
- Return a one-sentence plain-text result.
"""
        timestamp = get_hana_timestamp()
        tracker   = TestExecutionTracker("system_retry", prompt, timestamp)
        logger_cb = StepLogger(tracker)
        try:
            result    = await agent.ainvoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config={"callbacks": [logger_cb], "recursion_limit": 4},
            )
            final_msg = result["messages"][-1]
            answer    = final_msg.content if hasattr(final_msg, "content") else str(final_msg)
            return {"success": True, "skipped": False, "summary": answer, "steps": logger_cb.steps}
        except Exception as exc:
            logger.error("[RETRY] retry_failed_message error: %s", exc)
            return {"success": False, "skipped": False, "summary": str(exc), "steps": logger_cb.steps}

    # ── test iFlow after fix ─────────────────────────────────────────────────

    async def test_iflow_after_fix(self, incident: Dict[str, Any]) -> Dict[str, Any]:
        has_test_tool = any("test_iflow_with_payload" in t.name for t in self._mcp.tools)
        if not has_test_tool:
            return {
                "success": False,
                "skipped": True,
                "summary": "test_iflow_with_payload tool not available.",
            }

        agent = self._agent or self._mcp.agent
        if agent is None:
            return {"success": False, "skipped": True, "summary": "MCP agent not ready."}

        iflow_id     = incident.get("iflow_id", "")
        error_type   = incident.get("error_type", "")
        error_msg    = incident.get("error_message", "")
        proposed_fix = incident.get("proposed_fix", "")

        prompt = f"""IFLOW VERIFICATION — the fix has been deployed. Confirm it works with one test call.

iFlow ID: {iflow_id}
Original error type: {error_type}
Original error: {error_msg[:400]}
Applied fix: {proposed_fix[:400]}

INSTRUCTIONS:
1. Call get_iflow_endpoint with iflow_id='{iflow_id}' to discover the HTTP endpoint.
   - If it returns 0 endpoints, count=0, or "unable to fetch", the iFlow has no HTTP trigger
     (it may be SFTP, File, or scheduler-triggered). Immediately return:
     {{"test_passed": false, "http_status": null, "summary": "iFlow has no HTTP endpoint — test not applicable."}}
     Do NOT call test_iflow_with_payload in this case.
2. If an endpoint IS found, construct a minimal valid payload from the error context above
   and call test_iflow_with_payload once with iflow_id='{iflow_id}' and that payload.
3. Return EXACTLY this JSON (no markdown):
{{"test_passed": true/false, "http_status": <status code or null>, "summary": "<one sentence: what was sent and what the iFlow returned>"}}

Do NOT call get-iflow. Do NOT modify the iFlow. Do NOT call deploy. Do NOT fetch message logs.
"""
        timestamp = get_hana_timestamp()
        tracker   = TestExecutionTracker(
            incident.get("user_id", "system"),
            f"test_after_fix:{iflow_id}",
            timestamp,
        )
        logger_cb = StepLogger(tracker)
        try:
            result    = await asyncio.wait_for(
                agent.ainvoke(
                    {"messages": [{"role": "user", "content": prompt}]},
                    config={"callbacks": [logger_cb], "recursion_limit": 6},
                ),
                timeout=120.0,
            )
            final_msg = result["messages"][-1]
            answer    = final_msg.content if hasattr(final_msg, "content") else str(final_msg)
            try:
                parsed = json.loads(answer.strip())
            except Exception:
                parsed = {}
            test_passed = parsed.get("test_passed", False)
            logger.info(
                "[TEST_AFTER_FIX] iflow=%s test_passed=%s status=%s summary=%s",
                iflow_id, test_passed, parsed.get("http_status"), parsed.get("summary", "")[:200],
            )
            return {
                "success":     test_passed,
                "skipped":     False,
                "http_status": parsed.get("http_status"),
                "summary":     parsed.get("summary", answer[:200]),
                "steps":       logger_cb.steps,
            }
        except asyncio.TimeoutError:
            logger.warning("[TEST_AFTER_FIX] timed out for iflow=%s", iflow_id)
            return {
                "success": False, "skipped": True,
                "summary": "iFlow test timed out after 120s.", "steps": logger_cb.steps,
            }
        except Exception as exc:
            logger.error("[TEST_AFTER_FIX] error for iflow=%s: %s", iflow_id, exc)
            return {"success": False, "skipped": False, "summary": str(exc), "steps": logger_cb.steps}
