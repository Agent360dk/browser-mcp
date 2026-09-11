#!/usr/bin/env python3
"""E2E test for browser-mcp partition tooling (upstream-adapted).

Spawns a fresh `node index.js` from this directory, speaks MCP over stdio:
1. tools/list exposes the 3 partition tools + partition param on tools
2. default path still binds lazily and works untouched
3. partition create -> extension adopts -> navigate inside -> isolation both ways
4. unknown partition errors actionably; close semantics; default protected

Needs live Chrome + extension. Leaves no tabs or partitions behind.
"""
import json
import subprocess
import sys
from pathlib import Path

SERVER_DIR = str(Path(__file__).resolve().parent)
proc = subprocess.Popen(
    ["/usr/bin/node", "index.js"],
    cwd=SERVER_DIR,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1,
)

_next_id = [0]


def rpc(method, params=None, notify=False):
    msg = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    if notify:
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        return None
    _next_id[0] += 1
    msg["id"] = _next_id[0]
    proc.stdin.write(json.dumps(msg) + "\n")
    proc.stdin.flush()
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("server closed stdout")
        resp = json.loads(line)
        if resp.get("id") == msg["id"]:
            return resp


def call_tool(name, args=None):
    resp = rpc("tools/call", {"name": name, "arguments": args or {}})
    if resp.get("error"):
        raise RuntimeError(f"{name}: {resp['error']}")
    content = resp["result"]["content"]
    text = content[0].get("text", "")
    if resp["result"].get("isError"):
        raise RuntimeError(f"{name} failed: {text}")
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text


def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {label}" + (f"  -- {detail}" if detail else ""))
    if not cond:
        proc.terminate()
        sys.exit(1)


def cleanup():
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


# 1. init
init = rpc("initialize", {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "partition-test", "version": "1.0"},
})
rpc("notifications/initialized", notify=True)
check("initialize handshake", "serverInfo" in init.get("result", {}))

# 2. tools list
tools = rpc("tools/list")["result"]["tools"]
names = [t["name"] for t in tools]
for tname in ("browser_partition_new", "browser_partition_list", "browser_partition_close"):
    check(f"tool exposed: {tname}", tname in names)
for tname in ("browser_navigate", "browser_list_tabs", "browser_close_tab"):
    tdef = next(t for t in tools if t["name"] == tname)
    check(f"{tname} has partition param", "partition" in tdef["inputSchema"]["properties"])

# 3. default path binds lazily and works (untouched behavior)
res = call_tool("browser_navigate", {"url": "https://example.org/", "new_tab": True})
check("default navigate works", "example.org" in json.dumps(res).lower())
dtabs = call_tool("browser_list_tabs", {})
d_tab = next((x for x in dtabs["tabs"] if "example.org" in x.get("url", "")), None)
check("default sees its tab", d_tab is not None)
D_TAB = d_tab["id"]

# 4. create a partition; list shows default + new
res = call_tool("browser_partition_new", {"label": "partition-test"})
P = res["partition"]
check(f"partition created (port {P})", isinstance(P, int) and 9876 <= P <= 9895)
check("extension adopted partition", res.get("connected") is True, f"connected={res.get('connected')}")
lst = call_tool("browser_partition_list")
by_role = {p["role"]: p["partition"] for p in lst["partitions"]}
check("partition list shows default + new", by_role.get("default") is not None and P in by_role.values(),
      str(lst["partitions"])[:160])

# 5. navigate INSIDE the partition; isolation both directions
call_tool("browser_navigate", {"url": "https://example.com/", "partition": P})
ptabs = call_tool("browser_list_tabs", {"partition": P})
pjson = json.dumps(ptabs).lower()
check("partition sees its tab", "example.com" in pjson, str(ptabs)[:160])
check("partition does NOT see default tab", "example.org" not in pjson)
dtabs = call_tool("browser_list_tabs", {})
djson = json.dumps(dtabs).lower()
check("default does NOT see partition tab", "example.com" not in djson, str(dtabs)[:160])
P_TAB = next(x["id"] for x in ptabs["tabs"] if "example.com" in x.get("url", ""))

# 6. unknown partition errors actionably
resp = rpc("tools/call", {"name": "browser_navigate",
                          "arguments": {"url": "https://example.com/", "partition": 9894}})
errtext = resp["result"]["content"][0]["text"]
check("unknown partition gives actionable error",
      resp["result"].get("isError") and "browser_partition_new" in errtext, errtext[:120])

# 7. close partition tab + partition; close default tab; default protected
call_tool("browser_close_tab", {"tab_id": P_TAB, "partition": P})
res = call_tool("browser_partition_close", {"partition": P})
check("partition closed", res.get("closed") == P)
res = call_tool("browser_partition_list")
check("closed partition gone from list", P not in [p["partition"] for p in res["partitions"]])
call_tool("browser_close_tab", {"tab_id": D_TAB})
dtabs = call_tool("browser_list_tabs", {})
check("default tab cleaned up", "example.org" not in json.dumps(dtabs).lower())
dflt = next(p["partition"] for p in res["partitions"] if p["role"] == "default")
resp = rpc("tools/call", {"name": "browser_partition_close", "arguments": {"partition": dflt}})
check("closing default partition refused", "cannot be closed" in resp["result"]["content"][0]["text"])

print("\nALL TESTS PASSED")
cleanup()
