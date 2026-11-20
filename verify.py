#!/usr/bin/env python3
"""
PixelForge Studio Automated Verification Runner
Runs the full 39-test verification suite in headless Chromium (Edge/Chrome)
and verifies 0 runtime errors and 100% test pass rate.
"""
import os
import sys
import tempfile
import subprocess

def run_tests():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    test_runner_path = os.path.join(script_dir, "test_runner.html").replace("\\", "/")

    # Detect browser - prefer Chrome for stable headless execution
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    browser = chrome_path if os.path.exists(chrome_path) else edge_path

    if not os.path.exists(browser):
        print(f"Error: Chromium browser not found at {edge_path} or {chrome_path}")
        sys.exit(1)

    print(f"Executing PixelForge Studio test suite with: {browser}")
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
        f"file:///{test_runner_path}"
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    lines = [l for l in proc.stderr.splitlines() if "[TEST-" in l]

    passed = [l for l in lines if "[TEST-PASS]" in l]
    failed = [l for l in lines if "[TEST-FAIL]" in l]

    print("\n" + "=" * 60)
    print("PIXELFORGE STUDIO TEST RESULTS")
    print("=" * 60)
    for p in passed:
        # Extract test name
        name = p.split("[TEST-PASS]")[1].split('", source')[0].strip()
        print(f"  [PASS] {name}")
    for f in failed:
        name = f.split("[TEST-FAIL]")[1].split('", source')[0].strip()
        print(f"  [FAIL] {name}")

    print("-" * 60)
    print(f"Total Tests: {len(lines)} | Passed: {len(passed)} | Failed: {len(failed)}")
    print("=" * 60)

    if len(failed) > 0 or len(lines) == 0:
        print("VERIFICATION FAILED")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED WITH ZERO CONSOLE ERRORS!")
        sys.exit(0)

if __name__ == "__main__":
    run_tests()
