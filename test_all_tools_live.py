import os
import sys
import tempfile
import subprocess

def run_test():
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    script_dir = os.path.dirname(os.path.abspath(__file__))
    index_path = os.path.join(script_dir, "index.html").replace("\\", "/")
    
    harness_html = f"""<!DOCTYPE html>
<html>
<head><title>Full 13 Tools Cross-Test Harness</title></head>
<body>
<iframe id="app-frame" src="file:///{index_path}" style="width: 1400px; height: 900px; border:none;"></iframe>
<script>
window.addEventListener('load', () => {{
  setTimeout(async () => {{
    const frame = document.getElementById('app-frame');
    const win = frame.contentWindow;
    const doc = win.document;
    
    const results = [];
    function report(name, passed, detail) {{
      results.push({{ name, passed, detail }});
      console.log(`[TEST-${{passed ? 'PASS' : 'FAIL'}}] ${{name}} - ${{detail}}`);
    }}

    try {{
      const PF = win.PixelForge || win.GIMP;
      const engine = PF.currentEngine;
      const ui = PF.currentUI;
      const overlay = doc.getElementById('overlay-canvas');
      const getPt = (cx, cy) => engine.canvasToScreen(cx, cy);

      function simulateDrag(fromCanvas, toCanvas) {{
        const p1 = getPt(fromCanvas.x, fromCanvas.y);
        const p2 = getPt(toCanvas.x, toCanvas.y);
        const mid = getPt((fromCanvas.x + toCanvas.x)/2, (fromCanvas.y + toCanvas.y)/2);

        overlay.dispatchEvent(new win.PointerEvent('pointerdown', {{
          clientX: p1.x, clientY: p1.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
        }}));
        win.dispatchEvent(new win.PointerEvent('pointermove', {{
          clientX: mid.x, clientY: mid.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
        }}));
        win.dispatchEvent(new win.PointerEvent('pointermove', {{
          clientX: p2.x, clientY: p2.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
        }}));
        win.dispatchEvent(new win.PointerEvent('pointerup', {{
          clientX: p2.x, clientY: p2.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
        }}));
      }}

      function simulateClick(canvasPt, button = 0) {{
        const p = getPt(canvasPt.x, canvasPt.y);
        overlay.dispatchEvent(new win.PointerEvent('pointerdown', {{
          clientX: p.x, clientY: p.y, button: button, bubbles: true, cancelable: true, pointerId: 1
        }}));
        win.dispatchEvent(new win.PointerEvent('pointerup', {{
          clientX: p.x, clientY: p.y, button: button, bubbles: true, cancelable: true, pointerId: 1
        }}));
      }}

      // ==============================================================
      // 1. Smooth Blend Painter (brush)
      // ==============================================================
      engine.newDocument(400, 300, 'white');
      ui.selectTool('brush');
      engine.setFgColor('#e6261f'); // vibrant red
      ui.activeTool.options.size = 20;
      ui.activeTool.options.opacity = 100;
      
      simulateDrag({{ x: 50, y: 50 }}, {{ x: 150, y: 50 }});
      const pixBrush = engine.getActiveLayer().ctx.getImageData(100, 50, 1, 1).data;
      const brushOk = pixBrush[0] > 180 && pixBrush[1] < 60;
      report('Tool 1: Smooth Blend Painter (brush)', brushOk, `Red pixel at (100,50): [${{Array.from(pixBrush)}}]`);

      // ==============================================================
      // 2. Precision Pixel Writer (pencil)
      // ==============================================================
      ui.selectTool('pencil');
      engine.setFgColor('#00aa00'); // green
      ui.activeTool.options.size = 4;
      simulateDrag({{ x: 50, y: 100 }}, {{ x: 120, y: 100 }});
      const pixPencil = engine.getActiveLayer().ctx.getImageData(80, 100, 1, 1).data;
      const pencilOk = pixPencil[1] > 140 && pixPencil[0] < 50;
      report('Tool 2: Precision Pixel Writer (pencil)', pencilOk, `Green pixel at (80,100): [${{Array.from(pixPencil)}}]`);

      // ==============================================================
      // 3. Alpha Clearing Tool (eraser)
      // ==============================================================
      const eraseLayer = engine.addLayer('Erase Target', 400, 300, 'transparent');
      eraseLayer.ctx.fillStyle = '#123456';
      eraseLayer.ctx.fillRect(0, 0, 400, 300);
      ui.selectTool('eraser');
      ui.activeTool.options.size = 30;
      simulateDrag({{ x: 100, y: 150 }}, {{ x: 150, y: 150 }});
      const pixEraser = eraseLayer.ctx.getImageData(125, 150, 1, 1).data;
      const eraserOk = pixEraser[3] < 100;
      report('Tool 3: Alpha Clearing Tool (eraser)', eraserOk, `Alpha cleared at (125,150): alpha=${{pixEraser[3]}}`);
      engine.deleteLayer(eraseLayer.id);

      // ==============================================================
      // 4. Contiguous Area Flood (bucket)
      // ==============================================================
      ui.selectTool('bucket');
      engine.setFgColor('#1155ff'); // blue
      simulateClick({{ x: 300, y: 250 }});
      const pixBucket = engine.getActiveLayer().ctx.getImageData(300, 250, 1, 1).data;
      const bucketOk = pixBucket[2] > 200 && pixBucket[0] < 50;
      report('Tool 4: Contiguous Area Flood (bucket)', bucketOk, `Blue flood fill at (300,250): [${{Array.from(pixBucket)}}]`);

      // ==============================================================
      // 5. Pixel Color Sampler (picker)
      // ==============================================================
      engine.setFgColor('#ffffff'); // reset to white
      ui.selectTool('picker');
      simulateClick({{ x: 300, y: 250 }}); // click on the blue flood area
      const pickerHex = engine.fgColor.toLowerCase();
      const pickerOk = pickerHex.startsWith('#1155') || pickerHex === '#1155ff';
      report('Tool 5: Pixel Color Sampler (picker)', pickerOk, `Sampled fgColor: ${{pickerHex}}`);

      // ==============================================================
      // 6. Box Area Selector (rect-select)
      // ==============================================================
      ui.selectTool('rect-select');
      simulateDrag({{ x: 40, y: 40 }}, {{ x: 200, y: 160 }});
      const selActive = engine.selection && engine.selection.active;
      const selBounds = engine.selection.bounds;
      const rectOk = selActive && selBounds && selBounds.width === 160 && selBounds.height === 120;
      report('Tool 6: Box Area Selector (rect-select)', rectOk, `Selection bounds: ${{JSON.stringify(selBounds)}}`);

      // ==============================================================
      // 7. Oval Area Selector (ellipse-select)
      // ==============================================================
      ui.selectTool('ellipse-select');
      simulateDrag({{ x: 30, y: 30 }}, {{ x: 180, y: 130 }});
      const ovalOk = engine.selection.active && engine.selection.bounds.width === 150;
      report('Tool 7: Oval Area Selector (ellipse-select)', ovalOk, `Oval bounds: ${{JSON.stringify(engine.selection.bounds)}}`);

      // ==============================================================
      // 8. Freeform Outline Selector (lasso)
      // ==============================================================
      ui.selectTool('lasso');
      const pts = [{{ x: 50, y: 50 }}, {{ x: 120, y: 50 }}, {{ x: 120, y: 120 }}, {{ x: 50, y: 120 }}];
      const pStart = getPt(pts[0].x, pts[0].y);
      overlay.dispatchEvent(new win.PointerEvent('pointerdown', {{
        clientX: pStart.x, clientY: pStart.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
      }}));
      for (let i = 1; i < pts.length; i++) {{
        const pt = getPt(pts[i].x, pts[i].y);
        win.dispatchEvent(new win.PointerEvent('pointermove', {{
          clientX: pt.x, clientY: pt.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
        }}));
      }}
      const pEnd = getPt(pts[0].x, pts[0].y);
      win.dispatchEvent(new win.PointerEvent('pointerup', {{
        clientX: pEnd.x, clientY: pEnd.y, button: 0, bubbles: true, cancelable: true, pointerId: 1
      }}));
      const lassoOk = engine.selection.active;
      report('Tool 8: Freeform Outline Selector (lasso)', lassoOk, `Lasso active: ${{lassoOk}}`);
      engine.clearSelection();

      // ==============================================================
      // 9. Layer Position Shifter (move)
      // ==============================================================
      const moveLayer = engine.addLayer('Shift Test Layer', 100, 100, 'white');
      moveLayer.x = 20;
      moveLayer.y = 20;
      ui.selectTool('move');
      simulateDrag({{ x: 25, y: 25 }}, {{ x: 65, y: 55 }});
      const moveOk = moveLayer.x === 60 && moveLayer.y === 50;
      report('Tool 9: Layer Position Shifter (move)', moveOk, `Layer shifted to: x=${{moveLayer.x}}, y=${{moveLayer.y}} (expected 60, 50)`);

      // ==============================================================
      // 10. Canvas Frame Trimmer (crop)
      // ==============================================================
      ui.selectTool('crop');
      const cropTool = ui.activeTool;
      simulateDrag({{ x: 50, y: 50 }}, {{ x: 350, y: 250 }});
      const cropW = cropTool.cropRect ? cropTool.cropRect.w : 0;
      const cropH = cropTool.cropRect ? cropTool.cropRect.h : 0;
      cropTool.commitCrop(engine);
      const cropOk = engine.width === 300 && engine.height === 200;
      report('Tool 10: Canvas Frame Trimmer (crop)', cropOk, `Canvas trimmed to: ${{engine.width}}x${{engine.height}} (expected 300x200)`);

      // ==============================================================
      // 11. Typography Rasterizer (text)
      // ==============================================================
      ui.selectTool('text');
      ui.activeTool.options.text = 'TEST-FONT';
      const layerCountBefore = engine.layerManager.layers.length;
      simulateClick({{ x: 30, y: 30 }});
      const layerCountAfter = engine.layerManager.layers.length;
      const textLayer = engine.getActiveLayer();
      const textOk = (layerCountAfter > layerCountBefore) && textLayer.name.includes('TEST-FONT');
      report('Tool 11: Typography Rasterizer (text)', textOk, `New text layer added: ${{textLayer.name}}`);

      // ==============================================================
      // 12. Canvas Magnifier (zoom)
      // ==============================================================
      ui.selectTool('zoom');
      const zoomBefore = engine.zoom;
      simulateClick({{ x: 50, y: 50 }});
      const zoomAfter = engine.zoom;
      const zoomOk = zoomAfter > zoomBefore;
      report('Tool 12: Canvas Magnifier (zoom)', zoomOk, `Zoom changed from ${{zoomBefore.toFixed(2)}} to ${{zoomAfter.toFixed(2)}}`);

      // ==============================================================
      // 13. Viewport Canvas Scroller (pan)
      // ==============================================================
      ui.selectTool('pan');
      const panXBefore = engine.panX;
      const panYBefore = engine.panY;
      simulateDrag({{ x: 50, y: 50 }}, {{ x: 100, y: 80 }});
      const panOk = (engine.panX !== panXBefore) || (engine.panY !== panYBefore);
      report('Tool 13: Viewport Canvas Scroller (pan)', panOk, `Pan shifted: dx=${{engine.panX - panXBefore}}, dy=${{engine.panY - panYBefore}}`);

      const allPassed = results.every(r => r.passed);
      console.log(`[TEST-SUMMARY] Total: ${{results.length}}, Passed: ${{results.filter(r=>r.passed).length}}, Failed: ${{results.filter(r=>!r.passed).length}}`);

    }} catch (e) {{
      console.log('[TEST-ERROR] Exception in cross-test:', e.message, e.stack);
    }} finally {{
      setTimeout(() => window.close(), 500);
    }}
  }}, 1200);
}});
</script>
</body>
</html>
"""
    harness_path = os.path.join(script_dir, "test_13_tools_harness.html")
    with open(harness_path, "w", encoding="utf-8") as f:
        f.write(harness_html)
        
    td = tempfile.mkdtemp()
    cmd = [
        chrome_path,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--user-data-dir={td}",
        "--allow-file-access-from-files",
        "--enable-logging=stderr",
        "--log-level=0",
        "--window-size=1600,1000",
        f"file:///{harness_path.replace(os.sep, '/')}"
    ]
    
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    for line in proc.stderr.splitlines():
        if "[TEST-" in line:
            print(line)

if __name__ == "__main__":
    run_test()
