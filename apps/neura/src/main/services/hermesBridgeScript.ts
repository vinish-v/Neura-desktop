/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */

export const HERMES_BRIDGE_EVENT_PREFIX = '__NEURA_HERMES_EVENT__';

export const HERMES_BRIDGE_SCRIPT = String.raw`from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any

EVENT_PREFIX = "__NEURA_HERMES_EVENT__"
REAL_STDOUT = sys.stdout


def _safe_json(value: Any) -> Any:
    try:
        json.dumps(value, ensure_ascii=False)
        return value
    except Exception:
        return repr(value)


def _preview(value: Any, limit: int = 1800) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        try:
            value = json.dumps(value, ensure_ascii=False)
        except Exception:
            value = repr(value)
    value = value.strip()
    return value[:limit] + ("..." if len(value) > limit else "")


def emit(event_type: str, **payload: Any) -> None:
    event = {
        "type": event_type,
        "time": time.time(),
        **{key: _safe_json(value) for key, value in payload.items()},
    }
    REAL_STDOUT.write(EVENT_PREFIX + json.dumps(event, ensure_ascii=False) + "\n")
    REAL_STDOUT.flush()


class EventWriter:
    def __init__(self, stream_name: str) -> None:
        self.stream_name = stream_name
        self._buffer = ""

    def write(self, text: str) -> int:
        if not text:
            return 0
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line.strip():
                emit("stream.output", stream=self.stream_name, text=line)
        return len(text)

    def flush(self) -> None:
        if self._buffer.strip():
            emit("stream.output", stream=self.stream_name, text=self._buffer)
        self._buffer = ""


def create_session_db():
    try:
        from hermes_state import SessionDB

        return SessionDB()
    except Exception as exc:
        emit("session.warning", message=f"Session database unavailable: {exc}")
        return None


def load_input(input_path: str) -> dict[str, Any]:
    with open(input_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(description="Neura Hermes structured event bridge")
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    payload = load_input(args.input)

    hermes_root = payload.get("hermesRoot") or os.getcwd()
    cwd = payload.get("cwd") or os.getcwd()
    sys.path.insert(0, hermes_root)
    os.chdir(cwd)

    os.environ["HERMES_YOLO_MODE"] = "1"
    os.environ["HERMES_ACCEPT_HOOKS"] = "1"

    logging.disable(logging.CRITICAL)

    from run_agent import AIAgent

    def on_tool_progress(event_name: str, tool_name: str = "", preview: str | None = None, tool_args: Any = None, **kwargs: Any) -> None:
        emit(
            event_name or "tool.progress",
            toolName=tool_name,
            preview=preview,
            arguments=tool_args,
            duration=kwargs.get("duration"),
            isError=kwargs.get("is_error"),
        )

    def on_tool_start(call_id: str, tool_name: str, tool_args: Any) -> None:
        emit("tool.call.started", callId=call_id, toolName=tool_name, arguments=tool_args)

    def on_tool_complete(call_id: str, tool_name: str, tool_args: Any, result: Any) -> None:
        emit(
            "tool.call.completed",
            callId=call_id,
            toolName=tool_name,
            arguments=tool_args,
            resultPreview=_preview(result),
        )

    def on_status(channel: str, message: str) -> None:
        emit("status", channel=channel, message=message)

    def on_thinking(message: str) -> None:
        if message:
            emit("thinking", message=message)

    def on_reasoning(message: str) -> None:
        if message:
            emit("reasoning", message=_preview(message, 1000))

    def on_stream_delta(delta: str | None) -> None:
        if delta:
            emit("assistant.delta", text=delta)

    def on_clarify(question: str, choices: Any = None) -> str:
        emit("clarify.requested", question=question, choices=choices)
        if choices:
            return f"[Neura bridge: choose the best option from {choices} and continue.]"
        return "[Neura bridge: make the most reasonable assumption and continue.]"

    agent = AIAgent(
        api_key=payload.get("apiKey") or os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY"),
        base_url=payload.get("baseURL"),
        provider=payload.get("provider") or "custom",
        api_mode=payload.get("apiMode"),
        model=payload.get("model"),
        enabled_toolsets=payload.get("toolsets") or None,
        quiet_mode=True,
        platform="cli",
        session_id=payload.get("sessionId") or None,
        pass_session_id=True,
        save_trajectories=True,
        session_db=create_session_db(),
        tool_progress_callback=on_tool_progress,
        tool_start_callback=on_tool_start,
        tool_complete_callback=on_tool_complete,
        thinking_callback=on_thinking,
        reasoning_callback=on_reasoning,
        stream_delta_callback=on_stream_delta,
        status_callback=on_status,
        clarify_callback=on_clarify,
    )

    emit("run.started", cwd=cwd, model=payload.get("model"), toolsets=payload.get("toolsets") or [])
    try:
        with redirect_stdout(EventWriter("stdout")), redirect_stderr(EventWriter("stderr")):
            result = agent.run_conversation(
                payload.get("prompt") or "",
                conversation_history=payload.get("conversationHistory") or None,
                task_id=payload.get("sessionId") or None,
            )
            final_answer = (result or {}).get("final_response") or ""
        emit("run.completed", finalAnswer=final_answer)
        return 0
    except BaseException as exc:
        emit(
            "run.failed",
            error=str(exc),
            traceback=traceback.format_exc(limit=12),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
`;
