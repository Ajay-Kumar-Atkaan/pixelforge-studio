#!/usr/bin/env python3
"""
PixelForge Studio - Creative Tool Usability & Interactive Workflow E2E Runner
Executes test_usability_e2e.html in headless Chrome and validates real-world creative workflows:
- Interactive on-canvas typography typing (live entry, styling, Enter commit, Escape cancel)
- In-place layer renaming in the layers dock (double-click, Enter commit, Escape cancel, undo/redo)
- Live tool options dock responsiveness without tool re-selection
"""
import os
import sys
import tempfile
import subprocess

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    test_html = os.path.join(script_dir, "test_usability_e2e.html").replace("\\", "/")

    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    browser = chrome_path if os.path.exists(chrome_path) else edge_path

    if not os.path.exists(browser):
        print(f"Error: Chromium browser not found at {chrome_path} or {edge_path}")
        sys.exit(1)

    print(f"Executing Creative Usability E2E Suite with: {browser}")
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

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = [l for l in proc.stderr.splitlines() if "[USABILITY-" in l]

    passed = [l for l in lines if "[USABILITY-PASS]" in l]
    failed = [l for l in lines if "[USABILITY-FAIL]" in l]

    print("\n" + "=" * 70)
    print("PIXELFORGE STUDIO - CREATIVE USABILITY & WORKFLOW E2E REPORT")
    print("=" * 70)

    for p in passed:
        name = p.split("[USABILITY-PASS]")[1].split('", source')[0].strip()
        print(f"  [PASS] {name}")

    if failed:
        print("\nFAILURES:")
        for f in failed:
            name = f.split("[USABILITY-FAIL]")[1].split('", source')[0].strip()
            print(f"  [FAIL] {name}")

    print("-" * 70)
    print(f"Total Usability Tests: {len(passed) + len(failed)} | Passed: {len(passed)} | Failed: {len(failed)}")
    print("=" * 70)

    if len(failed) > 0 or len(passed) == 0:
        print("RESULT: CREATIVE USABILITY VERIFICATION FAILED")
        sys.exit(1)
    else:
        print("RESULT: 100% CREATIVE USABILITY VERIFICATION SUCCESSFUL!")
        sys.exit(0)

if __name__ == "__main__":
    main()
