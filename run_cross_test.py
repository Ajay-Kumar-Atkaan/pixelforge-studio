#!/usr/bin/env python3
"""
PixelForge Studio - Cross-Feature Test Matrix Runner
Executes cross_test.html covering all 13 tools, 53 menu actions, dialogs, layers, and viewports.
"""
import os
import sys
import tempfile
import subprocess

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    matrix_html = os.path.join(script_dir, "cross_test.html").replace("\\", "/")

    # Detect browser - prefer Chrome for stable headless execution
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    browser = chrome_path if os.path.exists(chrome_path) else edge_path

    if not os.path.exists(browser):
        print("Chromium browser not found")
        sys.exit(1)

    print(f"Launching Cross-Feature Matrix with: {browser}")
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
        f"file:///{matrix_html}"
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = [l for l in proc.stderr.splitlines() if "[MATRIX-" in l]

    passed = [l for l in lines if "[MATRIX-PASS]" in l]
    failed = [l for l in lines if "[MATRIX-FAIL]" in l]
    uncaught = [l for l in lines if "[MATRIX-UNCAUGHT]" in l]

    print("\n" + "=" * 65)
    print("PIXELFORGE STUDIO - CROSS-FEATURE TEST MATRIX REPORT")
    print("=" * 65)

    for p in passed:
        name = p.split("[MATRIX-PASS]")[1].split('", source')[0].strip()
        print(f"  [PASS] {name}")

    if failed:
        print("\nFAILURES:")
        for f in failed:
            name = f.split("[MATRIX-FAIL]")[1].split('", source')[0].strip()
            print(f"  [FAIL] {name}")

    if uncaught:
        print("\nUNCAUGHT RUNTIME ERRORS:")
        for u in uncaught:
            print(f"  {u}")

    print("-" * 65)
    print(f"Total Evaluated: {len(passed) + len(failed)} | Passed: {len(passed)} | Failed: {len(failed)} | Uncaught: {len(uncaught)}")
    print("=" * 65)

    if len(failed) > 0 or len(uncaught) > 0 or len(passed) == 0:
        print("RESULT: CROSS-FEATURE VERIFICATION FAILED")
        sys.exit(1)
    else:
        print("RESULT: 100% CROSS-FEATURE VERIFICATION SUCCESSFUL!")
        sys.exit(0)

if __name__ == "__main__":
    main()
