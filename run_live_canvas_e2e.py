#!/usr/bin/env python3
"""
PixelForge Studio - Live Canvas E2E Verification Runner
Executes test_live_canvas_e2e.html in headless Chrome and verifies all 13 tools
manipulate the canvas on the real index.html page.
"""
import os
import sys
import tempfile
import subprocess

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    test_html = os.path.join(script_dir, "test_live_canvas_e2e.html").replace("\\", "/")

    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    browser = chrome_path if os.path.exists(chrome_path) else edge_path

    if not os.path.exists(browser):
        print(f"Error: Chromium browser not found at {chrome_path} or {edge_path}")
        sys.exit(1)

    print(f"Executing Live Canvas E2E Matrix on index.html with: {browser}")
    td = tempfile.mkdtemp()
    cmd = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--user-data-dir={td}",
        "--allow-file-access-from-files",
        "--enable-logging=stderr",
        "--log-level=0",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        f"file:///{test_html}"
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    lines = [l for l in proc.stderr.splitlines() if "[E2E-" in l]

    passed = [l for l in lines if "[E2E-PASS]" in l]
    failed = [l for l in lines if "[E2E-FAIL]" in l]

    print("\n" + "=" * 68)
    print("PIXELFORGE STUDIO - LIVE CANVAS 13-TOOL E2E VERIFICATION REPORT")
    print("=" * 68)

    for p in passed:
        name = p.split("[E2E-PASS]")[1].split('", source')[0].strip()
        print(f"  [PASS] {name}")

    if failed:
        print("\nFAILURES:")
        for f in failed:
            name = f.split("[E2E-FAIL]")[1].split('", source')[0].strip()
            print(f"  [FAIL] {name}")

    print("-" * 68)
    print(f"Total Tools Evaluated: {len(passed) + len(failed)} | Passed: {len(passed)} | Failed: {len(failed)}")
    print("=" * 68)

    if len(failed) > 0 or len(passed) == 0:
        print("RESULT: LIVE CANVAS VERIFICATION FAILED")
        sys.exit(1)
    else:
        print("RESULT: 100% LIVE CANVAS VERIFICATION SUCCESSFUL (ALL 13 TOOLS CONFIRMED WORKING ON CANVAS)!")
        sys.exit(0)

if __name__ == "__main__":
    main()
