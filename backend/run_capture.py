"""CLI test harness: connects to the running backend, sends a question,
prints the full event stream, and saves it to disk.

Usage (backend must be running on port 8000):
    python run_capture.py
    python run_capture.py "Your custom question"
"""

import asyncio
import json
import sys
from collections import Counter
from uuid import uuid4

import websockets

BACKEND_WS = "ws://127.0.0.1:8000/ws/research"
DEFAULT_QUESTION = (
    "What are the main effects of microplastic pollution on marine ecosystems?"
)
EVENTS_FILE = "run_events.jsonl"
REPORT_FILE = "run_report.json"


async def capture(question: str) -> None:
    session_id = str(uuid4())
    url = f"{BACKEND_WS}/{session_id}"
    print(f"Connecting to {url}\nQuestion: {question}\n")

    events: list[dict] = []
    report_payload: dict | None = None

    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"question": question}))
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=120)
            except asyncio.TimeoutError:
                print("\n[timeout] no event for 120s — stopping.")
                break
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                print(f"[non-JSON frame] {raw!r}")
                continue

            events.append(event)
            _print_event(event)

            if event.get("type") == "report.ready":
                report_payload = event.get("payload", {})
                break
            if event.get("type") == "error":
                print("\n[error event — stopping]")
                break

    _save(events, report_payload)
    _summary(events)


def _print_event(event: dict) -> None:
    etype = event.get("type", "?")
    ts = event.get("timestamp", "")
    short_ts = ts[11:19] if len(ts) >= 19 else ts
    print(f"[{short_ts}] {etype}")
    for line in json.dumps(event.get("payload", {}), indent=2, ensure_ascii=False).splitlines():
        print(f"    {line}")
    print()


def _save(events: list[dict], report_payload: dict | None) -> None:
    with open(EVENTS_FILE, "w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(f"\nSaved {len(events)} events to {EVENTS_FILE}")
    if report_payload is not None:
        with open(REPORT_FILE, "w", encoding="utf-8") as f:
            json.dump(report_payload, f, indent=2, ensure_ascii=False)
        print(f"Saved report payload to {REPORT_FILE}")
    else:
        print("No report.ready captured (run did not complete).")


def _summary(events: list[dict]) -> None:
    print("\n" + "=" * 50 + "\nSUMMARY\n" + "=" * 50)
    for etype, n in Counter(e.get("type") for e in events).items():
        print(f"  {etype}: {n}")
    subagents = {
        e["payload"].get("subagent")
        for e in events
        if isinstance(e.get("payload"), dict) and e["payload"].get("subagent")
    }
    print(f"\n  Subagents that ran: {len(subagents)} -> {sorted(subagents)}")
    tool_calls = Counter(
        e["payload"].get("tool")
        for e in events
        if e.get("type") == "subagent.tool_call" and isinstance(e.get("payload"), dict)
    )
    print(f"  Tool calls: {dict(tool_calls) if tool_calls else 'none'}")
    report = next((e["payload"] for e in events if e.get("type") == "report.ready"), None)
    if report:
        print(f"  Citations in report: {len(report.get('citations', []))}")
    print("=" * 50)


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUESTION
    asyncio.run(capture(q))
