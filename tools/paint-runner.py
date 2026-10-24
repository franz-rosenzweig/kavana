#!/usr/bin/env python3
"""Runs ON the machine with the GPU (it has only Python 3.9's standard library to rely on):
starts imagegen-cc as an MCP server, makes one picture per job, and appends each result to
results.jsonl as it finishes. tools/paint-cats.js copies this over, starts it and fetches the pictures.
    python3 paint-runner.py <imagegen-cc binary> <data dir> <jobs.json> <results.jsonl>"""
import json, os, re, subprocess, sys, time

binary, data, jobs_file, results = sys.argv[1:5]
jobs = json.load(open(jobs_file))
env = dict(os.environ, IMAGEGEN_CC_DATA=data)
p = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
n = 0

def call(method, params=None):
    global n
    n += 1
    p.stdin.write((json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params or {}}) + "\n").encode())
    p.stdin.flush()
    while True:
        line = p.stdout.readline()
        if not line:
            raise SystemExit("imagegen-cc exited")
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if m.get("id") == n:
            return m

call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "kavana-paint", "version": "1"}})
p.stdin.write((json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n").encode())
p.stdin.flush()
for job in jobs:
    t0 = time.time()
    r = call("tools/call", {"name": "generate_image", "arguments": job["args"]})
    res = r.get("result") or {}
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
    files = sorted(set(re.findall(r"/[^\s\"'`]+\.(?:png|jpg|webp)", text)))
    rec = {"name": job["name"], "files": files, "seconds": round(time.time() - t0), "error": r.get("error") or (text[:300] if res.get("isError") else None)}
    with open(results, "a") as f:
        f.write(json.dumps(rec) + "\n")
with open(results, "a") as f:
    f.write(json.dumps({"done": True}) + "\n")
p.stdin.close()
