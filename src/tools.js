/**
 * PixelForge Studio - Tool Engine & Interactive Tools
 * Implementation of all descriptive PixelForge tools:
 * - Smooth Blend Painter (Brush)
 * - Precision Pixel Writer (Pencil)
 * - Alpha Clearing Tool (Eraser)
 * - Contiguous Area Flood (Bucket Fill)
 * - Pixel Color Sampler (Color Picker)
 * - Box Area Selector (Rect Select)
 * - Oval Area Selector (Ellipse Select)
 * - Freeform Outline Selector (Lasso)
 * - Layer Position Shifter (Move)
 * - Canvas Frame Trimmer (Crop)
 * - Typography Rasterizer (Text)
 * - Canvas Magnifier (Zoom)
 * - Viewport Canvas Scroller (Pan)
 */

(function(global) {
  'use strict';

  // Base Tool class
  class BaseTool {
    constructor(id, name, shortcut, icon) {
      this.id = id;
      this.name = name;
      this.shortcut = shortcut;
      this.icon = icon;
      this.cursor = 'crosshair';
      this.options = {};
    }

    activate(engine) {}
    deactivate(engine) {}
    onPointerDown(e, coords, engine) {}
    onPointerMove(e, coords, engine) {}
    onPointerUp(e, coords, engine) {}
    onKeyDown(e, engine) {}
    drawOverlay(ctx, engine) {}

    renderOptions(container, onChange) {
      container.innerHTML = `<div class="opt-group"><div class="opt-label">${this.name} Options</div></div>`;
    }

    createSlider(label, key, min, max, step, value, unit = '', onChange) {
      const group = document.createElement('div');
      group.className = 'opt-group';
      group.innerHTML = `
        <div class="opt-row">
          <span class="opt-label">${label}:</span>
          <span class="opt-val">${value}${unit}</span>
        </div>
        <div class="opt-slider-row">
          <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
          <input type="number" class="num-input" min="${min}" max="${max}" step="${step}" value="${value}">
        </div>
      `;
      const range = group.querySelector('input[type="range"]');
      const num = group.querySelector('input[type="number"]');
      const valDisplay = group.querySelector('.opt-val');

      const update = (v) => {
        v = Math.min(max, Math.max(min, Number(v)));
        this.options[key] = v;
        range.value = v;
        num.value = v;
        valDisplay.textContent = `${v}${unit}`;
        if (onChange) onChange(key, v);
      };

      range.addEventListener('input', (e) => update(e.target.value));
      num.addEventListener('change', (e) => update(e.target.value));
      return group;
    }

    createSelect(label, key, options, currentValue, onChange) {
      const group = document.createElement('div');
      group.className = 'opt-group';
      const selectHtml = options.map(opt => 
        `<option value="${opt.value}" ${opt.value === currentValue ? 'selected' : ''}>${opt.label}</option>`
      ).join('');
      group.innerHTML = `
        <div class="opt-row">
          <span class="opt-label">${label}:</span>
          <select>${selectHtml}</select>
        </div>
      `;
      const select = group.querySelector('select');
      select.addEventListener('change', (e) => {
        this.options[key] = e.target.value;
        if (onChange) onChange(key, e.target.value);
      });
      return group;
    }

    createCheckbox(label, key, checked, onChange) {
      const group = document.createElement('div');
      group.className = 'opt-group';
      group.innerHTML = `
        <div class="opt-row">
          <label class="opt-label" style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" ${checked ? 'checked' : ''}>
            <span>${label}</span>
          </label>
        </div>
      `;
      const cb = group.querySelector('input[type="checkbox"]');
      cb.addEventListener('change', (e) => {
        this.options[key] = e.target.checked;
        if (onChange) onChange(key, e.target.checked);
      });
      return group;
    }
  }

  // Helper for stroke interpolation
  function interpolatePoints(p1, p2, stepDist, callback) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, stepDist)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      callback(p1.x + dx * t, p1.y + dy * t);
    }
  }

  // 1. Smooth Blend Painter (Paintbrush)
  class BrushTool extends BaseTool {
    constructor() {
      super('brush', 'Smooth Blend Painter', 'P', 'brush');
      this.cursor = 'crosshair';
      this.options = {
        size: 20,
        hardness: 80,
        opacity: 100,
        spacing: 15
      };
      this.isDrawing = false;
      this.lastPos = null;
      this.cursorPos = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSlider('Brush Size', 'size', 1, 300, 1, this.options.size, 'px', onChange));
      container.appendChild(this.createSlider('Edge Hardness', 'hardness', 0, 100, 1, this.options.hardness, '%', onChange));
      container.appendChild(this.createSlider('Stroke Opacity', 'opacity', 1, 100, 1, this.options.opacity, '%', onChange));
      container.appendChild(this.createSlider('Spacing', 'spacing', 1, 100, 1, this.options.spacing, '%', onChange));
    }

    paintStamp(ctx, x, y, fgColor, engine) {
      const r = this.options.size / 2;
      const opacity = this.options.opacity > 1 ? this.options.opacity / 100 : Number(this.options.opacity !== undefined ? this.options.opacity : 1);
      const hardness = this.options.hardness > 1 ? this.options.hardness / 100 : Number(this.options.hardness !== undefined ? this.options.hardness : 0.8);
      const innerR = Math.max(0, r * hardness);

      ctx.save();
      // Apply active selection clipping if present
      if (engine.selection && engine.selection.active && engine.selection.applyClip) {
        engine.selection.applyClip(ctx);
      }

      ctx.globalAlpha = opacity;
      const activeLayer = engine.getActiveLayer();
      ctx.globalCompositeOperation = (activeLayer && activeLayer.alphaLocked) ? 'source-atop' : 'source-over';

      if (hardness >= 0.98) {
        ctx.fillStyle = fgColor;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(x, y, innerR, x, y, r);
        grad.addColorStop(0, fgColor);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked || !layer.visible) return;

      this.isDrawing = true;
      this.lastPos = { x: coords.x - layer.x, y: coords.y - layer.y };
      
      const stepDist = Math.max(1, this.options.size * (this.options.spacing / 100));
      this.paintStamp(layer.ctx, this.lastPos.x, this.lastPos.y, engine.fgColor, engine);
      engine.render();
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      if (!this.isDrawing) {
        engine.renderOverlay();
        return;
      }
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked) return;

      const currentPos = { x: coords.x - layer.x, y: coords.y - layer.y };
      const stepDist = Math.max(1, this.options.size * (this.options.spacing / 100));

      interpolatePoints(this.lastPos, currentPos, stepDist, (x, y) => {
        this.paintStamp(layer.ctx, x, y, engine.fgColor, engine);
      });

      this.lastPos = currentPos;
      engine.render();
      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.lastPos = null;
      engine.history.push('Smooth Blend Stroke');
      engine.render();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos) return;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(this.cursorPos.x, this.cursorPos.y, this.options.size / 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 2. Precision Pixel Writer (Pencil)
  class PencilTool extends BaseTool {
    constructor() {
      super('pencil', 'Precision Pixel Writer', 'N', 'pencil');
      this.cursor = 'crosshair';
      this.options = {
        size: 1,
        opacity: 100
      };
      this.isDrawing = false;
      this.lastPos = null;
      this.cursorPos = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSlider('Pixel Width', 'size', 1, 100, 1, this.options.size, 'px', onChange));
      container.appendChild(this.createSlider('Marking Opacity', 'opacity', 1, 100, 1, this.options.opacity, '%', onChange));
    }

    stamp(ctx, x, y, fgColor, engine) {
      const s = Math.max(1, Math.round(this.options.size));
      const half = Math.floor(s / 2);
      ctx.save();
      if (engine.selection && engine.selection.active && engine.selection.applyClip) {
        engine.selection.applyClip(ctx);
      }
      const activeLayer = engine.getActiveLayer();
      ctx.globalCompositeOperation = (activeLayer && activeLayer.alphaLocked) ? 'source-atop' : 'source-over';
      ctx.globalAlpha = this.options.opacity / 100;
      ctx.fillStyle = fgColor;
      ctx.imageSmoothingEnabled = false;
      ctx.fillRect(Math.round(x) - half, Math.round(y) - half, s, s);
      ctx.restore();
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked || !layer.visible) return;

      this.isDrawing = true;
      this.lastPos = { x: coords.x - layer.x, y: coords.y - layer.y };
      this.stamp(layer.ctx, this.lastPos.x, this.lastPos.y, engine.fgColor, engine);
      engine.render();
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      if (!this.isDrawing) {
        engine.renderOverlay();
        return;
      }
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked) return;

      const currentPos = { x: coords.x - layer.x, y: coords.y - layer.y };
      interpolatePoints(this.lastPos, currentPos, Math.max(1, this.options.size * 0.5), (x, y) => {
        this.stamp(layer.ctx, x, y, engine.fgColor, engine);
      });
      this.lastPos = currentPos;
      engine.render();
      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.lastPos = null;
      engine.history.push('Precision Pixel Mark');
      engine.render();
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos) return;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      const s = Math.max(1, Math.round(this.options.size));
      const half = Math.floor(s / 2);
      ctx.strokeRect(Math.round(this.cursorPos.x) - half, Math.round(this.cursorPos.y) - half, s, s);
      ctx.restore();
    }
  }

  // 3. Alpha Clearing Tool (Eraser)
  class EraserTool extends BaseTool {
    constructor() {
      super('eraser', 'Alpha Clearing Tool', 'Shift+E', 'eraser');
      this.cursor = 'crosshair';
      this.options = {
        size: 30,
        hardness: 80,
        opacity: 100,
        spacing: 15
      };
      this.isDrawing = false;
      this.lastPos = null;
      this.cursorPos = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSlider('Clearing Radius', 'size', 1, 300, 1, this.options.size, 'px', onChange));
      container.appendChild(this.createSlider('Edge Hardness', 'hardness', 0, 100, 1, this.options.hardness, '%', onChange));
      container.appendChild(this.createSlider('Clearing Strength', 'opacity', 1, 100, 1, this.options.opacity, '%', onChange));
    }

    eraseStamp(ctx, x, y, engine) {
      const r = this.options.size / 2;
      const opacity = this.options.opacity > 1 ? this.options.opacity / 100 : Number(this.options.opacity !== undefined ? this.options.opacity : 1);
      const hardness = this.options.hardness > 1 ? this.options.hardness / 100 : Number(this.options.hardness !== undefined ? this.options.hardness : 0.8);
      const innerR = Math.max(0, r * hardness);

      ctx.save();
      if (engine.selection && engine.selection.active && engine.selection.applyClip) {
        engine.selection.applyClip(ctx);
      }
      const activeLayer = engine.getActiveLayer();
      if (activeLayer && activeLayer.alphaLocked) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = opacity;
        ctx.fillStyle = engine.bgColor || '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = opacity;

      if (hardness >= 0.98) {
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(x, y, innerR, x, y, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked || !layer.visible) return;

      this.isDrawing = true;
      this.lastPos = { x: coords.x - layer.x, y: coords.y - layer.y };
      this.eraseStamp(layer.ctx, this.lastPos.x, this.lastPos.y, engine);
      engine.render();
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      if (!this.isDrawing) {
        engine.renderOverlay();
        return;
      }
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked) return;

      const currentPos = { x: coords.x - layer.x, y: coords.y - layer.y };
      const stepDist = Math.max(1, this.options.size * (this.options.spacing / 100));
      interpolatePoints(this.lastPos, currentPos, stepDist, (x, y) => {
        this.eraseStamp(layer.ctx, x, y, engine);
      });
      this.lastPos = currentPos;
      engine.render();
      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      this.lastPos = null;
      engine.history.push('Clear Alpha Region');
      engine.render();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos) return;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(this.cursorPos.x, this.cursorPos.y, this.options.size / 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 4. Contiguous Area Flood (Bucket Fill)
  class BucketFillTool extends BaseTool {
    constructor() {
      super('bucket', 'Contiguous Area Flood', 'Shift+B', 'bucket');
      this.cursor = 'crosshair';
      this.options = {
        fillType: 'fg', // 'fg' or 'bg'
        affectedArea: 'similar', // 'similar' or 'selection'
        tolerance: 20, // 0 - 255
        opacity: 100
      };
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Flood Color', 'fillType', [
        { label: 'Foreground Color Fill', value: 'fg' },
        { label: 'Background Color Fill', value: 'bg' }
      ], this.options.fillType, onChange));
      container.appendChild(this.createSelect('Flood Target', 'affectedArea', [
        { label: 'Flood Contiguous Matching Pixels', value: 'similar' },
        { label: 'Flood Entire Selection Bounds', value: 'selection' }
      ], this.options.affectedArea, onChange));
      container.appendChild(this.createSlider('Color Tolerance', 'tolerance', 0, 255, 1, this.options.tolerance, '', onChange));
      container.appendChild(this.createSlider('Fill Opacity', 'opacity', 1, 100, 1, this.options.opacity, '%', onChange));
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      const layer = engine.getActiveLayer();
      if (!layer || layer.locked || !layer.visible) return;

      const fillHex = this.options.fillType === 'bg' ? engine.bgColor : engine.fgColor;
      const targetRgba = engine.hexToRgba(fillHex, this.options.opacity / 100);

      // If filling whole selection or if selection is active without similar colors
      if (this.options.affectedArea === 'selection' || (engine.selection && engine.selection.active && this.options.affectedArea !== 'similar')) {
        layer.ctx.save();
        if (engine.selection && engine.selection.active && engine.selection.applyClip) {
          engine.selection.applyClip(layer.ctx);
        }
        layer.ctx.fillStyle = `rgba(${targetRgba[0]}, ${targetRgba[1]}, ${targetRgba[2]}, ${targetRgba[3] / 255})`;
        layer.ctx.fillRect(0, 0, layer.width, layer.height);
        layer.ctx.restore();
        engine.history.push('Contiguous Area Flood');
        engine.render();
        return;
      }

      // Flood fill similar colors
      const startX = Math.floor(coords.x - layer.x);
      const startY = Math.floor(coords.y - layer.y);
      if (startX < 0 || startX >= layer.width || startY < 0 || startY >= layer.height) return;

      const imgData = layer.ctx.getImageData(0, 0, layer.width, layer.height);
      const w = imgData.width;
      const h = imgData.height;
      const data = imgData.data;
      const data32 = new Uint32Array(data.buffer);

      const startIndex = startY * w + startX;
      const startR = data[startIndex * 4];
      const startG = data[startIndex * 4 + 1];
      const startB = data[startIndex * 4 + 2];
      const startA = data[startIndex * 4 + 3];

      const fillR = targetRgba[0];
      const fillG = targetRgba[1];
      const fillB = targetRgba[2];
      const fillA = targetRgba[3];

      // Little-endian RGBA packing
      const fillVal32 = (fillA << 24) | (fillB << 16) | (fillG << 8) | fillR;
      const tolSq = this.options.tolerance * this.options.tolerance * 3;

      function colorMatch(idx) {
        const i = idx * 4;
        const dr = data[i] - startR;
        const dg = data[i + 1] - startG;
        const db = data[i + 2] - startB;
        const da = data[i + 3] - startA;
        return (dr * dr + dg * dg + db * db + (da * da) * 0.5) <= tolSq;
      }

      const visited = new Uint8Array(w * h);
      const queue = [startIndex];
      visited[startIndex] = 1;

      while (queue.length > 0) {
        const idx = queue.pop();
        const px = idx % w;
        const py = Math.floor(idx / w);

        data32[idx] = fillVal32;

        const neighbors = [
          px > 0 ? idx - 1 : -1,
          px < w - 1 ? idx + 1 : -1,
          py > 0 ? idx - w : -1,
          py < h - 1 ? idx + w : -1
        ];

        for (const n of neighbors) {
          if (n !== -1 && !visited[n] && colorMatch(n)) {
            const nx = (n % w) + layer.x;
            const ny = Math.floor(n / w) + layer.y;
            if (engine.selection && engine.selection.active && !engine.selection.contains(nx, ny)) {
              continue;
            }
            visited[n] = 1;
            queue.push(n);
          }
        }
      }

      layer.ctx.putImageData(imgData, 0, 0);
      engine.history.push('Contiguous Area Flood');
      engine.render();
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.cursorPos.x, this.cursorPos.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = engine.fgColor;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
  }

  // 5. Pixel Color Sampler (Color Picker)
  class ColorPickerTool extends BaseTool {
    constructor() {
      super('picker', 'Pixel Color Sampler', 'O', 'picker');
      this.cursor = 'crosshair';
      this.options = {
        sampleMerged: true,
        pickTarget: 'fg'
      };
      this.cursorPos = null;
      this.hoverColor = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createCheckbox('Sample Merged Canvas', 'sampleMerged', this.options.sampleMerged, onChange));
      container.appendChild(this.createSelect('Assign Sampled Color', 'pickTarget', [
        { label: 'Set Foreground Color', value: 'fg' },
        { label: 'Set Background Color', value: 'bg' }
      ], this.options.pickTarget, onChange));
    }

    sampleColor(coords, engine) {
      const x = Math.floor(coords.x);
      const y = Math.floor(coords.y);
      if (x < 0 || x >= engine.width || y < 0 || y >= engine.height) return null;

      let ctx;
      if (this.options.sampleMerged) {
        if (engine && engine.render) engine.render();
        ctx = engine.compositeCanvas.getContext('2d');
      } else {
        const layer = engine.getActiveLayer();
        if (!layer) return null;
        ctx = layer.ctx;
      }

      let pixel = ctx.getImageData(x, y, 1, 1).data;
      if (pixel[3] === 0 && engine.getActiveLayer()) {
        pixel = engine.getActiveLayer().ctx.getImageData(x, y, 1, 1).data;
      }
      const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
      return hex;
    }

    onPointerDown(e, coords, engine) {
      const hex = this.sampleColor(coords, engine);
      if (!hex) return;

      const isBg = (e.button === 2) || (e.ctrlKey) || (this.options.pickTarget === 'bg');
      if (isBg) {
        engine.setBgColor(hex);
      } else {
        engine.setFgColor(hex);
      }
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      this.hoverColor = this.sampleColor(coords, engine);
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos || !this.hoverColor) return;
      ctx.save();
      // Draw eyedropper loupe ring preview
      ctx.beginPath();
      ctx.arc(this.cursorPos.x + 14, this.cursorPos.y - 14, 9, 0, Math.PI * 2);
      ctx.fillStyle = this.hoverColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      ctx.restore();
    }
  }

  // 6. Box Area Selector (Rectangle Select)
  class RectSelectTool extends BaseTool {
    constructor() {
      super('rect-select', 'Box Area Selector', 'R', 'rect-select');
      this.cursor = 'crosshair';
      this.options = {
        mode: 'replace',
        feather: 0
      };
      this.isSelecting = false;
      this.start = null;
      this.current = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Selection Mode', 'mode', [
        { label: 'Replace Current Selection', value: 'replace' },
        { label: 'Add to Selection (Shift)', value: 'add' },
        { label: 'Subtract from Selection (Ctrl)', value: 'subtract' }
      ], this.options.mode, onChange));
      container.appendChild(this.createSlider('Feather Edge Radius', 'feather', 0, 50, 1, this.options.feather, 'px', onChange));
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      this.isSelecting = true;
      this.start = { x: coords.x, y: coords.y };
      this.current = { x: coords.x, y: coords.y };
    }

    onPointerMove(e, coords, engine) {
      if (!this.isSelecting) return;
      this.current = { x: coords.x, y: coords.y };
      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isSelecting) return;
      this.isSelecting = false;

      const x = Math.min(this.start.x, this.current.x);
      const y = Math.min(this.start.y, this.current.y);
      const w = Math.abs(this.current.x - this.start.x);
      const h = Math.abs(this.current.y - this.start.y);

      if (w > 2 && h > 2) {
        let mode = this.options.mode;
        if (e.shiftKey) mode = 'add';
        if (e.altKey || e.ctrlKey) mode = 'subtract';

        engine.selection.setRect(x, y, w, h, mode, this.options.feather);
        engine.history.push('Box Area Selection');
      }
      this.start = null;
      this.current = null;
      engine.render();
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.isSelecting || !this.start || !this.current) return;
      const x = Math.min(this.start.x, this.current.x);
      const y = Math.min(this.start.y, this.current.y);
      const w = Math.abs(this.current.x - this.start.x);
      const h = Math.abs(this.current.y - this.start.y);

      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 4;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }

  // 7. Oval Area Selector (Ellipse Select)
  class EllipseSelectTool extends BaseTool {
    constructor() {
      super('ellipse-select', 'Oval Area Selector', 'E', 'ellipse-select');
      this.cursor = 'crosshair';
      this.options = {
        mode: 'replace',
        feather: 0
      };
      this.isSelecting = false;
      this.start = null;
      this.current = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Selection Mode', 'mode', [
        { label: 'Replace Current Selection', value: 'replace' },
        { label: 'Add to Selection (Shift)', value: 'add' },
        { label: 'Subtract from Selection (Ctrl)', value: 'subtract' }
      ], this.options.mode, onChange));
      container.appendChild(this.createSlider('Feather Edge Radius', 'feather', 0, 50, 1, this.options.feather, 'px', onChange));
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      this.isSelecting = true;
      this.start = { x: coords.x, y: coords.y };
      this.current = { x: coords.x, y: coords.y };
    }

    onPointerMove(e, coords, engine) {
      if (!this.isSelecting) return;
      this.current = { x: coords.x, y: coords.y };
      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isSelecting) return;
      this.isSelecting = false;

      const x = Math.min(this.start.x, this.current.x);
      const y = Math.min(this.start.y, this.current.y);
      const w = Math.abs(this.current.x - this.start.x);
      const h = Math.abs(this.current.y - this.start.y);

      if (w > 2 && h > 2) {
        let mode = this.options.mode;
        if (e.shiftKey) mode = 'add';
        if (e.altKey || e.ctrlKey) mode = 'subtract';

        engine.selection.setEllipse(x + w / 2, y + h / 2, w / 2, h / 2, mode, this.options.feather);
        engine.history.push('Oval Area Selection');
      }
      this.start = null;
      this.current = null;
      engine.render();
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.isSelecting || !this.start || !this.current) return;
      const x = Math.min(this.start.x, this.current.x);
      const y = Math.min(this.start.y, this.current.y);
      const w = Math.abs(this.current.x - this.start.x);
      const h = Math.abs(this.current.y - this.start.y);

      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 4;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 8. Freeform Outline Selector (Lasso)
  class LassoSelectTool extends BaseTool {
    constructor() {
      super('lasso', 'Freeform Outline Selector', 'F', 'lasso');
      this.cursor = 'crosshair';
      this.options = {
        mode: 'replace',
        feather: 0
      };
      this.isSelecting = false;
      this.points = [];
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Selection Mode', 'mode', [
        { label: 'Replace Current Selection', value: 'replace' },
        { label: 'Add to Selection (Shift)', value: 'add' },
        { label: 'Subtract from Selection (Ctrl)', value: 'subtract' }
      ], this.options.mode, onChange));
      container.appendChild(this.createSlider('Feather Edge Radius', 'feather', 0, 50, 1, this.options.feather, 'px', onChange));
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      this.isSelecting = true;
      this.points = [{ x: coords.x, y: coords.y }];
    }

    onPointerMove(e, coords, engine) {
      if (!this.isSelecting) return;
      this.points.push({ x: coords.x, y: coords.y });
      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isSelecting) return;
      this.isSelecting = false;

      if (this.points.length > 2) {
        let mode = this.options.mode;
        if (e.shiftKey) mode = 'add';
        if (e.altKey || e.ctrlKey) mode = 'subtract';

        engine.selection.setPolygon(this.points, mode, this.options.feather);
        engine.history.push('Freeform Outline Selection');
      }
      this.points = [];
      engine.render();
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.isSelecting || this.points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }
      ctx.stroke();

      ctx.strokeStyle = '#000000';
      ctx.lineDashOffset = 4;
      ctx.stroke();
      ctx.restore();
    }
  }

  // 9. Layer Position Shifter (Move)
  class MoveTool extends BaseTool {
    constructor() {
      super('move', 'Layer Position Shifter', 'M', 'move');
      this.cursor = 'move';
      this.options = {
        target: 'layer'
      };
      this.isDragging = false;
      this.lastPos = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Shift Target', 'target', [
        { label: 'Shift Active Layer Position', value: 'layer' },
        { label: 'Shift Selection Boundary', value: 'selection' }
      ], this.options.target, onChange));
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.lastPos = { x: coords.x, y: coords.y };
    }

    onPointerMove(e, coords, engine) {
      if (!this.isDragging || !this.lastPos) return;
      const dx = coords.x - this.lastPos.x;
      const dy = coords.y - this.lastPos.y;

      if (this.options.target === 'layer') {
        const layer = engine.getActiveLayer();
        if (layer && !layer.locked) {
          layer.x += dx;
          layer.y += dy;
          engine.render();
        }
      } else if (this.options.target === 'selection' && engine.selection && engine.selection.active) {
        engine.selection.translate(dx, dy);
        engine.renderOverlay();
      }

      this.lastPos = { x: coords.x, y: coords.y };
    }

    onPointerUp(e, coords, engine) {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.lastPos = null;
      engine.history.push('Shift Layer Position');
      engine.render();
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      const layer = engine.getActiveLayer();
      if (!layer) return;
      ctx.save();
      ctx.strokeStyle = '#4a82d0';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
      ctx.restore();
    }
  }

  // 10. Canvas Frame Trimmer (Crop)
  class CropTool extends BaseTool {
    constructor() {
      super('crop', 'Canvas Frame Trimmer', 'Shift+C', 'crop');
      this.cursor = 'crosshair';
      this.options = {
        deleteCropped: true
      };
      this.isDragging = false;
      this.dragMode = null; // 'new' | 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w'
      this.cropRect = null;
      this.dragStart = null;
      this.initialRect = null;
    }

    get cropBox() {
      return this.cropRect;
    }

    set cropBox(val) {
      this.cropRect = val;
    }

    activate(engine) {
      if (engine) engine.renderOverlay();
    }

    deactivate(engine) {
      this.cropRect = null;
      this.isDragging = false;
      this.dragMode = null;
      if (engine) engine.renderOverlay();
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createCheckbox('Discard Trimmed Margins', 'deleteCropped', this.options.deleteCropped, onChange));
      
      const hint = document.createElement('div');
      hint.style.fontSize = '11px';
      hint.style.color = '#aaa';
      hint.style.marginTop = '6px';
      hint.style.lineHeight = '1.4';
      hint.innerHTML = 'Drag the <strong>corner or edge handles</strong> to frame the crop area. Press <strong>Enter</strong> or click Commit to apply.';
      container.appendChild(hint);

      const commitBtn = document.createElement('button');
      commitBtn.style.marginTop = '10px';
      commitBtn.style.width = '100%';
      commitBtn.style.padding = '8px 12px';
      commitBtn.style.background = '#23467c';
      commitBtn.style.color = '#fff';
      commitBtn.style.border = '1px solid #4a82d0';
      commitBtn.style.borderRadius = '3px';
      commitBtn.style.cursor = 'pointer';
      commitBtn.style.fontWeight = 'bold';
      commitBtn.textContent = 'Commit Canvas Trim (Enter)';
      commitBtn.onclick = () => {
        const engine = (window.PixelForge && window.PixelForge.currentEngine) || (window.GIMP && window.GIMP.currentEngine);
        const ui = (window.PixelForge && window.PixelForge.currentUI) || (window.GIMP && window.GIMP.currentUI);
        if (this.cropRect && engine) {
          const w = this.cropRect.w;
          const h = this.cropRect.h;
          this.commitCrop(engine);
          if (ui && ui.showToast) ui.showToast(`Canvas trimmed to ${w} × ${h} px`, 'success');
        } else if (ui && ui.showToast) {
          ui.showToast('Click and drag across the canvas to define a crop boundary first.', 'info');
        }
      };
      container.appendChild(commitBtn);

      const resetBtn = document.createElement('button');
      resetBtn.style.marginTop = '6px';
      resetBtn.style.width = '100%';
      resetBtn.style.padding = '6px 12px';
      resetBtn.style.background = '#333';
      resetBtn.style.color = '#ccc';
      resetBtn.style.border = '1px solid #444';
      resetBtn.style.borderRadius = '3px';
      resetBtn.style.cursor = 'pointer';
      resetBtn.textContent = 'Reset Crop Frame to Full Image';
      resetBtn.onclick = () => {
        const engine = (window.PixelForge && window.PixelForge.currentEngine) || (window.GIMP && window.GIMP.currentEngine);
        if (engine) {
          this.cropRect = { x: 0, y: 0, w: engine.width, h: engine.height };
          engine.renderOverlay();
        }
      };
      container.appendChild(resetBtn);
    }

    getHandleUnder(coords) {
      if (!this.cropRect) return null;
      const r = this.cropRect;
      const handleSize = 14;
      const handles = {
        'nw': { x: r.x, y: r.y },
        'ne': { x: r.x + r.w, y: r.y },
        'se': { x: r.x + r.w, y: r.y + r.h },
        'sw': { x: r.x, y: r.y + r.h },
        'n': { x: r.x + r.w / 2, y: r.y },
        's': { x: r.x + r.w / 2, y: r.y + r.h },
        'w': { x: r.x, y: r.y + r.h / 2 },
        'e': { x: r.x + r.w, y: r.y + r.h / 2 }
      };

      for (const [name, pos] of Object.entries(handles)) {
        if (Math.abs(coords.x - pos.x) <= handleSize && Math.abs(coords.y - pos.y) <= handleSize) {
          return name;
        }
      }
      return null;
    }

    isInsideCrop(coords) {
      if (!this.cropRect) return false;
      const r = this.cropRect;
      return coords.x >= r.x && coords.x <= r.x + r.w && coords.y >= r.y && coords.y <= r.y + r.h;
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.dragStart = { x: coords.x, y: coords.y };

      const handle = this.getHandleUnder(coords);
      if (handle) {
        this.dragMode = handle;
        this.initialRect = { ...this.cropRect };
      } else if (this.isInsideCrop(coords)) {
        this.dragMode = 'move';
        this.initialRect = { ...this.cropRect };
      } else {
        this.dragMode = 'new';
        this.cropRect = { x: Math.round(coords.x), y: Math.round(coords.y), w: 0, h: 0 };
        this.initialRect = null;
      }
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      if (!this.isDragging) {
        // Update cursor
        const handle = this.getHandleUnder(coords);
        if (handle) {
          const cursorMap = {
            'nw': 'nwse-resize', 'se': 'nwse-resize',
            'ne': 'nesw-resize', 'sw': 'nesw-resize',
            'n': 'ns-resize', 's': 'ns-resize',
            'w': 'ew-resize', 'e': 'ew-resize'
          };
          this.cursor = cursorMap[handle] || 'crosshair';
        } else if (this.isInsideCrop(coords)) {
          this.cursor = 'move';
        } else {
          this.cursor = 'crosshair';
        }
        engine.renderOverlay();
        return;
      }

      const dx = coords.x - this.dragStart.x;
      const dy = coords.y - this.dragStart.y;

      if (this.dragMode === 'new') {
        let x = Math.min(this.dragStart.x, coords.x);
        let y = Math.min(this.dragStart.y, coords.y);
        let w = Math.abs(coords.x - this.dragStart.x);
        let h = Math.abs(coords.y - this.dragStart.y);
        this.cropRect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
      } else if (this.dragMode === 'move') {
        let x = this.initialRect.x + dx;
        let y = this.initialRect.y + dy;
        this.cropRect = { x: Math.round(x), y: Math.round(y), w: this.initialRect.w, h: this.initialRect.h };
      } else if (this.initialRect) {
        let { x, y, w, h } = this.initialRect;
        if (this.dragMode.includes('e')) w += dx;
        if (this.dragMode.includes('s')) h += dy;
        if (this.dragMode.includes('w')) { x += dx; w -= dx; }
        if (this.dragMode.includes('n')) { y += dy; h -= dy; }
        if (w >= 10 && h >= 10) {
          this.cropRect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
        }
      }

      engine.renderOverlay();
    }

    onPointerUp(e, coords, engine) {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.dragMode = null;
      this.dragStart = null;
      this.initialRect = null;

      if (this.cropRect) {
        let { x, y, w, h } = this.cropRect;
        if (w < 0) { x += w; w = Math.abs(w); }
        if (h < 0) { y += h; h = Math.abs(h); }
        if (w < 10 || h < 10) {
          this.cropRect = { x: 20, y: 20, w: Math.max(50, engine.width - 40), h: Math.max(50, engine.height - 40) };
        } else {
          this.cropRect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
        }
      }
      engine.renderOverlay();
    }

    onKeyDown(e, engine) {
      if (e.key === 'Enter' && this.cropRect) {
        this.commitCrop(engine);
      } else if (e.key === 'Escape') {
        this.cropRect = null;
        engine.renderOverlay();
      }
    }

    commitCrop(engine) {
      if (!this.cropRect) return;
      engine.crop(this.cropRect.x, this.cropRect.y, this.cropRect.w, this.cropRect.h);
      this.cropRect = null;
      engine.history.push('Trim Canvas Frame');
      engine.render();
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.cropRect) {
        if (!this.cursorPos) return;
        ctx.save();
        ctx.strokeStyle = '#4a82d0';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(Math.round(this.cursorPos.x - 12), Math.round(this.cursorPos.y - 12), 24, 24);
        ctx.restore();
        return;
      }
      const r = this.cropRect;
      let x = r.x, y = r.y, w = r.w, h = r.h;

      ctx.save();
      // Dim outer area
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, engine.width, y);
      ctx.fillRect(0, y + h, engine.width, engine.height - (y + h));
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, engine.width - (x + w), h);

      // Crop box border
      ctx.strokeStyle = '#4a82d0';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);

      // Inner white dashed line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // Rule of thirds grid
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x + w / 3, y); ctx.lineTo(x + w / 3, y + h);
      ctx.moveTo(x + (2 * w) / 3, y); ctx.lineTo(x + (2 * w) / 3, y + h);
      ctx.moveTo(x, y + h / 3); ctx.lineTo(x + w, y + h / 3);
      ctx.moveTo(x, y + (2 * h) / 3); ctx.lineTo(x + w, y + (2 * h) / 3);
      ctx.stroke();

      // Draw 8 solid handle grip squares
      const hs = 8;
      const handles = [
        [x, y], [x + w / 2, y], [x + w, y],
        [x + w, y + h / 2], [x + w, y + h],
        [x + w / 2, y + h], [x, y + h], [x, y + h / 2]
      ];
      ctx.fillStyle = '#4a82d0';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      for (const [hx, hy] of handles) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }

      // Dimension badge
      const badgeText = `${w} × ${h} px`;
      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(badgeText).width;
      ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
      ctx.fillRect(x + 4, y + 4, tw + 10, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(badgeText, x + 9, y + 17);

      ctx.restore();
    }
  }

  // 11. Typography Rasterizer (Text)
  class TextTool extends BaseTool {
    constructor() {
      super('text', 'Typography Rasterizer', 'T', 'text');
      this.cursor = 'text';
      this.options = {
        fontFamily: 'sans-serif',
        fontSize: 28,
        bold: false,
        italic: false,
        text: 'PixelForge Studio'
      };
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Typeface Family', 'fontFamily', [
        { label: 'Sans-Serif', value: 'sans-serif' },
        { label: 'Serif', value: 'serif' },
        { label: 'Monospace', value: 'monospace' },
        { label: 'Arial', value: 'Arial, sans-serif' },
        { label: 'Times New Roman', value: '"Times New Roman", serif' },
        { label: 'Impact', value: 'Impact, sans-serif' }
      ], this.options.fontFamily, onChange));

      container.appendChild(this.createSlider('Type Size', 'fontSize', 8, 144, 1, this.options.fontSize, 'px', onChange));
      container.appendChild(this.createCheckbox('Bold Weight', 'bold', this.options.bold, onChange));
      container.appendChild(this.createCheckbox('Italic Oblique', 'italic', this.options.italic, onChange));

      const group = document.createElement('div');
      group.className = 'opt-group';
      group.innerHTML = `
        <div class="opt-label">Text Content:</div>
        <textarea style="width:100%;height:60px;margin-top:4px;" placeholder="Type text here...">${this.options.text}</textarea>
      `;
      const textarea = group.querySelector('textarea');
      textarea.addEventListener('input', (e) => {
        this.options.text = e.target.value;
      });
      container.appendChild(group);
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0) return;
      let text = this.options.text;
      if (!text && typeof window !== 'undefined' && typeof window.prompt === 'function') {
        try {
          text = window.prompt('Enter typography text to rasterize:', 'PixelForge');
        } catch (_) {}
      }
      text = text || 'PixelForge';
      this.options.text = text;

      const layer = engine.addLayer(`Type: ${text.slice(0, 10)}`);
      layer.ctx.save();
      const style = `${this.options.italic ? 'italic ' : ''}${this.options.bold ? 'bold ' : ''}${this.options.fontSize}px ${this.options.fontFamily}`;
      layer.ctx.font = style;
      layer.ctx.fillStyle = engine.fgColor;
      layer.ctx.textBaseline = 'top';
      layer.ctx.fillText(text, coords.x, coords.y);
      layer.ctx.restore();

      engine.history.push('Rasterize Typography');
      engine.render();
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos) return;
      ctx.save();
      ctx.strokeStyle = '#4a82d0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.cursorPos.x, this.cursorPos.y - 14);
      ctx.lineTo(this.cursorPos.x, this.cursorPos.y + 4);
      ctx.moveTo(this.cursorPos.x - 5, this.cursorPos.y - 14);
      ctx.lineTo(this.cursorPos.x + 5, this.cursorPos.y - 14);
      ctx.moveTo(this.cursorPos.x - 5, this.cursorPos.y + 4);
      ctx.lineTo(this.cursorPos.x + 5, this.cursorPos.y + 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 12. Canvas Magnifier (Zoom)
  class ZoomTool extends BaseTool {
    constructor() {
      super('zoom', 'Canvas Magnifier', 'Z', 'zoom');
      this.cursor = 'zoom-in';
      this.options = {
        direction: 'in'
      };
      this.cursorPos = null;
    }

    renderOptions(container, onChange) {
      container.innerHTML = '';
      container.appendChild(this.createSelect('Magnification Action', 'direction', [
        { label: 'Magnify In (1.25x)', value: 'in' },
        { label: 'Magnify Out (0.8x)', value: 'out' }
      ], this.options.direction, onChange));

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '4px';
      row.style.marginTop = '8px';
      row.innerHTML = `
        <button id="zoom-100-btn" style="flex:1;">100%</button>
        <button id="zoom-fit-btn" style="flex:1;">Fit Window</button>
      `;
      const getEngine = () => (window.PixelForge && window.PixelForge.currentEngine) || (window.GIMP && window.GIMP.currentEngine);
      row.querySelector('#zoom-100-btn').onclick = () => {
        const eng = getEngine();
        if (eng) eng.setZoom(1.0);
      };
      row.querySelector('#zoom-fit-btn').onclick = () => {
        const eng = getEngine();
        if (eng) eng.fitToWindow();
      };
      container.appendChild(row);
    }

    onPointerDown(e, coords, engine) {
      const zoomIn = this.options.direction === 'in' ? !e.ctrlKey && !e.altKey : e.ctrlKey || e.altKey;
      const factor = zoomIn ? 1.25 : 0.8;
      engine.setZoom(engine.zoom * factor, coords);
    }

    onPointerMove(e, coords, engine) {
      this.cursorPos = coords;
      engine.renderOverlay();
    }

    drawOverlay(ctx, engine) {
      if (!this.cursorPos) return;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.cursorPos.x, this.cursorPos.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.cursorPos.x, this.cursorPos.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.options.direction === 'in' ? '+' : '-', this.cursorPos.x, this.cursorPos.y);
      ctx.restore();
    }
  }

  // 13. Viewport Canvas Scroller (Pan)
  class PanTool extends BaseTool {
    constructor() {
      super('pan', 'Viewport Canvas Scroller', 'H', 'pan');
      this.cursor = 'grab';
      this.isPanning = false;
      this.startScreen = null;
    }

    onPointerDown(e, coords, engine) {
      if (e.button !== 0 && e.button !== 1) return;
      this.isPanning = true;
      this.startScreen = { x: e.clientX, y: e.clientY };
      engine.viewportContainer.classList.add('panning');
    }

    onPointerMove(e, coords, engine) {
      if (!this.isPanning || !this.startScreen) return;
      const dx = e.clientX - this.startScreen.x;
      const dy = e.clientY - this.startScreen.y;
      engine.panBy(dx, dy);
      this.startScreen = { x: e.clientX, y: e.clientY };
    }

    onPointerUp(e, coords, engine) {
      if (!this.isPanning) return;
      this.isPanning = false;
      this.startScreen = null;
      engine.viewportContainer.classList.remove('panning');
    }
  }

  // Registry of all tools (with both short keys and logical descriptive keys)
  const ToolRegistry = {
    brush: new BrushTool(),
    pencil: new PencilTool(),
    eraser: new EraserTool(),
    bucket: new BucketFillTool(),
    picker: new ColorPickerTool(),
    'rect-select': new RectSelectTool(),
    'ellipse-select': new EllipseSelectTool(),
    lasso: new LassoSelectTool(),
    move: new MoveTool(),
    crop: new CropTool(),
    text: new TextTool(),
    zoom: new ZoomTool(),
    pan: new PanTool(),
    // Descriptive name aliases
    'smooth-blend-painter': null,
    'precision-pixel-writer': null,
    'alpha-clearing-tool': null,
    'contiguous-area-flood': null,
    'pixel-color-sampler': null,
    'box-area-selector': null,
    'oval-area-selector': null,
    'freeform-outline-selector': null,
    'layer-position-shifter': null,
    'canvas-frame-trimmer': null,
    'typography-rasterizer': null,
    'canvas-magnifier': null,
    'viewport-canvas-scroller': null
  };

  // Wire descriptive aliases to instances
  ToolRegistry['smooth-blend-painter'] = ToolRegistry.brush;
  ToolRegistry['precision-pixel-writer'] = ToolRegistry.pencil;
  ToolRegistry['alpha-clearing-tool'] = ToolRegistry.eraser;
  ToolRegistry['contiguous-area-flood'] = ToolRegistry.bucket;
  ToolRegistry['pixel-color-sampler'] = ToolRegistry.picker;
  ToolRegistry['box-area-selector'] = ToolRegistry['rect-select'];
  ToolRegistry['oval-area-selector'] = ToolRegistry['ellipse-select'];
  ToolRegistry['freeform-outline-selector'] = ToolRegistry.lasso;
  ToolRegistry['layer-position-shifter'] = ToolRegistry.move;
  ToolRegistry['canvas-frame-trimmer'] = ToolRegistry.crop;
  ToolRegistry['typography-rasterizer'] = ToolRegistry.text;
  ToolRegistry['canvas-magnifier'] = ToolRegistry.zoom;
  ToolRegistry['viewport-canvas-scroller'] = ToolRegistry.pan;

  // Export to PixelForge namespace (with GIMP alias for compatibility)
  global.PixelForge = global.PixelForge || global.GIMP || {};
  global.PixelForge.BaseTool = BaseTool;
  global.PixelForge.ToolRegistry = ToolRegistry;
  global.GIMP = global.PixelForge;

})(typeof window !== 'undefined' ? window : this);
