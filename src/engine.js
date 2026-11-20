/**
 * PixelForge Studio - Core Canvas Engine & Document Controller
 * Manages rendering, layer compositing, selection masking, undo/redo history,
 * viewport transformations, rulers, image/project I/O, and tool interactions.
 */

(function (root) {
  'use strict';

  root.PixelForge = root.PixelForge || {};
  root.GIMP = root.PixelForge; // Backward compatibility alias

  // ==========================================
  // 1. Selection Model
  // ==========================================

  class SelectionModel {
    constructor(engine) {
      this.engine = engine;
      this.active = false;
      this.bounds = null; // { x, y, width, height }
      this.paths = []; // Array of path segments or primitives
      this.marchingAntsOffset = 0;

      // 8-bit Alpha Mask Canvas
      this.maskCanvas = document.createElement('canvas');
      this.maskCanvas.width = engine.width;
      this.maskCanvas.height = engine.height;
      this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    }

    resize(newWidth, newHeight) {
      const temp = document.createElement('canvas');
      temp.width = this.maskCanvas.width;
      temp.height = this.maskCanvas.height;
      temp.getContext('2d').drawImage(this.maskCanvas, 0, 0);

      this.maskCanvas.width = newWidth;
      this.maskCanvas.height = newHeight;
      this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
      this.maskCtx.drawImage(temp, 0, 0);
    }

    clear() {
      this.active = false;
      this.bounds = null;
      this.paths = [];
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.engine.emit('selectionChanged', { active: false });
    }

    selectAll() {
      this.active = true;
      this.bounds = { x: 0, y: 0, width: this.engine.width, height: this.engine.height };
      this.paths = [{ type: 'rect', x: 0, y: 0, w: this.engine.width, h: this.engine.height }];
      this.maskCtx.fillStyle = '#ffffff';
      this.maskCtx.fillRect(0, 0, this.engine.width, this.engine.height);
      this.engine.emit('selectionChanged', { active: true, bounds: this.bounds });
    }

    invert() {
      if (!this.active) {
        this.selectAll();
        return;
      }
      const imgData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      const data = imgData.data;
      const len = data.length;
      let hasSelected = false;

      for (let i = 0; i < len; i += 4) {
        const inv = 255 - data[i + 3];
        data[i] = inv;
        data[i + 1] = inv;
        data[i + 2] = inv;
        data[i + 3] = inv;
        if (inv > 0) hasSelected = true;
      }
      this.maskCtx.putImageData(imgData, 0, 0);
      this.active = hasSelected;
      this.paths = [];
      this.recalculateBounds();
      this.engine.emit('selectionChanged', { active: this.active, bounds: this.bounds });
    }

    setRect(x, y, w, h, mode = 'replace', feather = 0) {
      if (mode === 'replace') {
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        this.paths = [];
      }

      this.maskCtx.save();
      if (mode === 'subtract') {
        this.maskCtx.globalCompositeOperation = 'destination-out';
        this.maskCtx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        this.maskCtx.globalCompositeOperation = 'source-over';
        this.maskCtx.fillStyle = '#ffffff';
      }

      this.maskCtx.fillRect(x, y, w, h);
      this.maskCtx.restore();

      if (feather > 0) {
        this.feather(feather);
      }

      this.paths.push({ type: 'rect', x, y, w, h, mode });
      this.active = true;
      this.recalculateBounds();
      this.engine.emit('selectionChanged', { active: true, bounds: this.bounds });
    }

    setEllipse(cx, cy, rx, ry, mode = 'replace', feather = 0) {
      if (mode === 'replace') {
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        this.paths = [];
      }

      this.maskCtx.save();
      if (mode === 'subtract') {
        this.maskCtx.globalCompositeOperation = 'destination-out';
        this.maskCtx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        this.maskCtx.globalCompositeOperation = 'source-over';
        this.maskCtx.fillStyle = '#ffffff';
      }

      this.maskCtx.beginPath();
      this.maskCtx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      this.maskCtx.fill();
      this.maskCtx.restore();

      if (feather > 0) {
        this.feather(feather);
      }

      this.paths.push({ type: 'ellipse', cx, cy, rx, ry, mode });
      this.active = true;
      this.recalculateBounds();
      this.engine.emit('selectionChanged', { active: true, bounds: this.bounds });
    }

    setPolygon(points, mode = 'replace', feather = 0) {
      if (!points || points.length < 3) return;

      if (mode === 'replace') {
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        this.paths = [];
      }

      this.maskCtx.save();
      if (mode === 'subtract') {
        this.maskCtx.globalCompositeOperation = 'destination-out';
        this.maskCtx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        this.maskCtx.globalCompositeOperation = 'source-over';
        this.maskCtx.fillStyle = '#ffffff';
      }

      this.maskCtx.beginPath();
      this.maskCtx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        this.maskCtx.lineTo(points[i].x, points[i].y);
      }
      this.maskCtx.closePath();
      this.maskCtx.fill();
      this.maskCtx.restore();

      if (feather > 0) {
        this.feather(feather);
      }

      this.paths.push({ type: 'polygon', points: points.slice(), mode });
      this.active = true;
      this.recalculateBounds();
      this.engine.emit('selectionChanged', { active: true, bounds: this.bounds });
    }

    feather(radius) {
      if (radius <= 0 || !root.GIMP.Filters || !root.GIMP.Filters.gaussianBlur) return;
      const imgData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      root.GIMP.Filters.gaussianBlur(imgData, { radius });
      this.maskCtx.putImageData(imgData, 0, 0);
    }

    translate(dx, dy) {
      if (!this.active) return;
      const temp = document.createElement('canvas');
      temp.width = this.maskCanvas.width;
      temp.height = this.maskCanvas.height;
      temp.getContext('2d').drawImage(this.maskCanvas, 0, 0);

      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.maskCtx.drawImage(temp, dx, dy);

      for (const p of this.paths) {
        if (p.type === 'rect') {
          p.x += dx;
          p.y += dy;
        } else if (p.type === 'ellipse') {
          p.cx += dx;
          p.cy += dy;
        } else if (p.type === 'polygon' && p.points) {
          for (const pt of p.points) {
            pt.x += dx;
            pt.y += dy;
          }
        }
      }

      if (this.bounds) {
        this.bounds.x += dx;
        this.bounds.y += dy;
      }
    }

    recalculateBounds() {
      const imgData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      const data = imgData.data;
      const w = imgData.width;
      const h = imgData.height;

      let minX = w, maxX = 0, minY = h, maxY = 0;
      let count = 0;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const alpha = data[(y * w + x) * 4 + 3];
          if (alpha > 10) {
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (count === 0) {
        this.active = false;
        this.bounds = null;
      } else {
        this.bounds = {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1
        };
      }
    }

    contains(x, y) {
      if (!this.active) return true;
      if (x < 0 || x >= this.maskCanvas.width || y < 0 || y >= this.maskCanvas.height) return false;
      const pixel = this.maskCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      return pixel[3] > 128;
    }

    getMaskData() {
      return this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    }

    applyClip(ctx) {
      if (!this.active) return;

      if (this.paths.length > 0) {
        ctx.beginPath();
        for (const p of this.paths) {
          if (p.type === 'rect') {
            ctx.rect(p.x, p.y, p.w, p.h);
          } else if (p.type === 'ellipse') {
            ctx.ellipse(p.cx, p.cy, Math.max(1, p.rx), Math.max(1, p.ry), 0, 0, Math.PI * 2);
          } else if (p.type === 'polygon' && p.points && p.points.length > 0) {
            ctx.moveTo(p.points[0].x, p.points[0].y);
            for (let i = 1; i < p.points.length; i++) {
              ctx.lineTo(p.points[i].x, p.points[i].y);
            }
            ctx.closePath();
          }
        }
        ctx.clip();
      }
    }

    drawMarchingAnts(ctx) {
      if (!this.active) return;

      this.marchingAntsOffset = (Date.now() / 80) % 8;

      ctx.save();
      ctx.lineWidth = 1;

      if (this.paths.length > 0) {
        for (const p of this.paths) {
          ctx.beginPath();
          if (p.type === 'rect') {
            ctx.rect(p.x, p.y, p.w, p.h);
          } else if (p.type === 'ellipse') {
            ctx.ellipse(p.cx, p.cy, Math.max(1, p.rx), Math.max(1, p.ry), 0, 0, Math.PI * 2);
          } else if (p.type === 'polygon' && p.points && p.points.length > 1) {
            ctx.moveTo(p.points[0].x, p.points[0].y);
            for (let i = 1; i < p.points.length; i++) {
              ctx.lineTo(p.points[i].x, p.points[i].y);
            }
            ctx.closePath();
          }

          // Dual-stroke contrast
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = this.marchingAntsOffset;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          ctx.lineDashOffset = this.marchingAntsOffset + 4;
          ctx.strokeStyle = '#000000';
          ctx.stroke();
        }
      } else if (this.bounds) {
        // Fallback to bounding box if path representation is not available
        const b = this.bounds;
        ctx.beginPath();
        ctx.rect(b.x, b.y, b.width, b.height);

        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = this.marchingAntsOffset;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.lineDashOffset = this.marchingAntsOffset + 4;
        ctx.strokeStyle = '#000000';
        ctx.stroke();
      }

      ctx.restore();
    }

    serialize() {
      return {
        active: this.active,
        bounds: this.bounds ? Object.assign({}, this.bounds) : null,
        paths: JSON.parse(JSON.stringify(this.paths || [])),
        maskDataUrl: this.active ? this.maskCanvas.toDataURL('image/png') : null
      };
    }

    async deserialize(data) {
      if (!data) return;
      this.active = !!data.active;
      this.bounds = data.bounds ? Object.assign({}, data.bounds) : null;
      this.paths = Array.isArray(data.paths) ? data.paths : [];
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);

      if (this.active && data.maskDataUrl) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            this.maskCtx.drawImage(img, 0, 0);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = data.maskDataUrl;
        });
      }
    }
  }

  // ==========================================
  // 2. History & Undo/Redo Engine
  // ==========================================

  class HistoryStack {
    constructor(engine, maxDepth = 30) {
      this.engine = engine;
      this.maxDepth = maxDepth;
      this.snapshots = [];
      this.currentIndex = -1;
      this.isExecuting = false;
      this.listeners = new Map();
    }

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (!this.listeners.has(event)) return;
      this.listeners.set(event, this.listeners.get(event).filter(cb => cb !== callback));
    }

    emit(event, data) {
      if (!this.listeners.has(event)) return;
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in HistoryStack event [${event}]:`, err);
        }
      }
    }

    async push(actionName = 'Edit') {
      if (this.isExecuting) return;

      const snapshot = {
        id: 'hist_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
        description: actionName,
        timestamp: Date.now(),
        width: this.engine.width,
        height: this.engine.height,
        activeLayerIndex: this.engine.layerManager.activeLayerIndex,
        layers: this.engine.layerManager.serialize().layers,
        selection: this.engine.selection.serialize()
      };

      // If we made edits after undoing, truncate the redo branch
      if (this.currentIndex < this.snapshots.length - 1) {
        this.snapshots = this.snapshots.slice(0, this.currentIndex + 1);
      }

      this.snapshots.push(snapshot);
      if (this.snapshots.length > this.maxDepth) {
        this.snapshots.shift();
      }
      this.currentIndex = this.snapshots.length - 1;

      this.engine.emit('historyChanged', this.getStack());
      this.emit('changed', this.getStack());
    }

    canUndo() {
      return this.currentIndex > 0;
    }

    canRedo() {
      return this.currentIndex < this.snapshots.length - 1;
    }

    async undo() {
      if (!this.canUndo() || this.isExecuting) return false;
      this.isExecuting = true;
      try {
        this.currentIndex--;
        await this.restoreSnapshot(this.snapshots[this.currentIndex]);
      } finally {
        this.isExecuting = false;
        this.engine.emit('historyChanged', this.getStack());
        this.emit('changed', this.getStack());
        this.engine.render();
      }
      return true;
    }

    async redo() {
      if (!this.canRedo() || this.isExecuting) return false;
      this.isExecuting = true;
      try {
        this.currentIndex++;
        await this.restoreSnapshot(this.snapshots[this.currentIndex]);
      } finally {
        this.isExecuting = false;
        this.engine.emit('historyChanged', this.getStack());
        this.emit('changed', this.getStack());
        this.engine.render();
      }
      return true;
    }

    async jumpTo(index) {
      if (index < 0 || index >= this.snapshots.length || index === this.currentIndex || this.isExecuting) return;
      this.isExecuting = true;
      try {
        this.currentIndex = index;
        await this.restoreSnapshot(this.snapshots[this.currentIndex]);
      } finally {
        this.isExecuting = false;
        this.engine.emit('historyChanged', this.getStack());
        this.emit('changed', this.getStack());
        this.engine.render();
      }
    }

    async restoreSnapshot(snapshot) {
      if (!snapshot) return;

      // Restore document size if changed
      if (this.engine.width !== snapshot.width || this.engine.height !== snapshot.height) {
        this.engine.width = snapshot.width;
        this.engine.height = snapshot.height;
        this.engine.updateCanvasSize();
      }

      // Restore layer stack
      await this.engine.layerManager.deserialize({
        width: snapshot.width,
        height: snapshot.height,
        activeLayerIndex: snapshot.activeLayerIndex,
        layers: snapshot.layers
      });

      // Restore selection
      if (snapshot.selection) {
        await this.engine.selection.deserialize(snapshot.selection);
      }
    }

    getStack() {
      return this.snapshots.map((s, idx) => ({
        id: s.id,
        description: s.description,
        timestamp: s.timestamp,
        active: idx === this.currentIndex,
        index: idx
      }));
    }
  }

  // ==========================================
  // 3. GimpEngine Core Application Class
  // ==========================================

  class GimpEngine {
    constructor(options = {}) {
      this.width = Math.max(1, parseInt(options.width, 10) || 800);
      this.height = Math.max(1, parseInt(options.height, 10) || 600);

      // Palettes
      this.fgColor = options.fgColor || '#000000';
      this.bgColor = options.bgColor || '#ffffff';

      // Viewport state
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
      this.showGrid = false;
      this.showRulers = true;

      // Clipboard
      this.clipboard = null; // { width, height, canvas }

      // Event Emitter
      this.listeners = new Map();

      // DOM Elements Initialization
      this.initDomElements(options);

      // Core Subsystems
      this.layerManager = new root.GIMP.LayerManager(this.width, this.height);
      this.layers = this.layerManager; // Alias for UI compatibility
      this.selection = new SelectionModel(this);
      this.history = new HistoryStack(this, 35);

      // Forward layer manager events
      this.layerManager.on('changed', () => {
        this.render();
        this.emit('layersChanged');
      });
      this.layerManager.on('activeLayerChanged', (data) => {
        this.emit('activeLayerChanged', data);
      });

      // Active Tool
      this.activeTool = null;
      this.setupToolEvents();

      // Save initial project history state
      this.history.push('New Document');

      // Global references
      root.PixelForge.currentEngine = this;
      root.GIMP.currentEngine = this;

      // Start marching ants animation loop
      this.startRenderLoop();
    }

    initDomElements(options) {
      this.viewportContainer = document.getElementById('canvas-scroll-container') || options.viewportContainer;
      this.canvasWrapper = document.getElementById('canvas-wrapper') || options.canvasWrapper;
      this.mainCanvas = document.getElementById('main-canvas') || options.mainCanvas;
      this.overlayCanvas = document.getElementById('overlay-canvas') || options.overlayCanvas;

      // Rulers
      this.rulerTopCanvas = document.querySelector('.ruler-top canvas');
      this.rulerLeftCanvas = document.querySelector('.ruler-left canvas');

      // Create fallback canvases if not found in DOM
      if (!this.mainCanvas) {
        this.mainCanvas = document.createElement('canvas');
        this.mainCanvas.id = 'main-canvas';
      }
      if (!this.overlayCanvas) {
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'overlay-canvas';
      }

      this.mainCtx = this.mainCanvas.getContext('2d', { willReadFrequently: true });
      this.overlayCtx = this.overlayCanvas.getContext('2d');

      // Offscreen composite canvas
      this.compositeCanvas = document.createElement('canvas');
      this.compositeCtx = this.compositeCanvas.getContext('2d', { willReadFrequently: true });

      this.updateCanvasSize();
    }

    updateCanvasSize() {
      // Internal pixel resolution
      this.mainCanvas.width = this.width;
      this.mainCanvas.height = this.height;
      this.overlayCanvas.width = this.width;
      this.overlayCanvas.height = this.height;
      this.compositeCanvas.width = this.width;
      this.compositeCanvas.height = this.height;

      // Set CSS dimensions on wrapper
      if (this.canvasWrapper) {
        this.canvasWrapper.style.width = `${this.width}px`;
        this.canvasWrapper.style.height = `${this.height}px`;
      }

      if (this.selection) {
        this.selection.resize(this.width, this.height);
      }

      this.updateViewportTransform();
      this.emit('docResized', { width: this.width, height: this.height });
    }

    // ==========================================
    // Event System
    // ==========================================

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (!this.listeners.has(event)) return;
      const list = this.listeners.get(event).filter(cb => cb !== callback);
      this.listeners.set(event, list);
    }

    emit(event, data) {
      if (!this.listeners.has(event)) return;
      const callbacks = this.listeners.get(event);
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in Engine event [${event}]:`, err);
        }
      }
    }

    // ==========================================
    // Viewport & Coordinate Systems
    // ==========================================

    setZoom(newZoom, centerCoords = null) {
      const clamped = Math.max(0.05, Math.min(32.0, Number(newZoom)));
      if (Math.abs(this.zoom - clamped) < 0.001) return;

      this.zoom = clamped;
      this.updateViewportTransform();
      this.emit('zoomChanged', { zoom: this.zoom });
      this.renderOverlay();
      this.renderRulers();
    }

    panBy(dx, dy) {
      this.panX += dx;
      this.panY += dy;
      this.updateViewportTransform();
      this.emit('viewportChanged', { panX: this.panX, panY: this.panY, zoom: this.zoom });
      this.renderRulers();
    }

    fitToWindow() {
      if (!this.viewportContainer) return;
      const rect = this.viewportContainer.getBoundingClientRect();
      const margin = 40;
      const availW = Math.max(100, rect.width - margin);
      const availH = Math.max(100, rect.height - margin);

      const scale = Math.min(availW / this.width, availH / this.height, 1.0);
      this.panX = 0;
      this.panY = 0;
      this.setZoom(scale);
    }

    updateViewportTransform() {
      if (!this.canvasWrapper) return;
      this.canvasWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }

    screenToCanvas(clientX, clientY) {
      if (!this.mainCanvas) return { x: 0, y: 0 };
      const rect = this.mainCanvas.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { x: Math.round(clientX), y: Math.round(clientY) };
      }
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;

      const x = Math.round((clientX - rect.left) * scaleX);
      const y = Math.round((clientY - rect.top) * scaleY);

      return { x, y };
    }

    canvasToScreen(canvasX, canvasY) {
      if (!this.mainCanvas) return { x: 0, y: 0 };
      const rect = this.mainCanvas.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { x: Math.round(canvasX), y: Math.round(canvasY) };
      }
      const x = rect.left + (canvasX / this.width) * rect.width;
      const y = rect.top + (canvasY / this.height) * rect.height;
      return { x, y };
    }

    // ==========================================
    // Color Management
    // ==========================================

    setFgColor(hex) {
      this.fgColor = hex;
      this.emit('colorChanged', { fgColor: this.fgColor, bgColor: this.bgColor });
    }

    setBgColor(hex) {
      this.bgColor = hex;
      this.emit('colorChanged', { fgColor: this.fgColor, bgColor: this.bgColor });
    }

    swapColors() {
      const temp = this.fgColor;
      this.fgColor = this.bgColor;
      this.bgColor = temp;
      this.emit('colorChanged', { fgColor: this.fgColor, bgColor: this.bgColor });
    }

    resetColors() {
      this.fgColor = '#000000';
      this.bgColor = '#ffffff';
      this.emit('colorChanged', { fgColor: this.fgColor, bgColor: this.bgColor });
    }

    hexToRgba(hex, alpha = 1.0) {
      let c = hex.replace('#', '');
      if (c.length === 3) {
        c = c.split('').map(char => char + char).join('');
      }
      const num = parseInt(c, 16);
      return [
        (num >> 16) & 255,
        (num >> 8) & 255,
        num & 255,
        Math.round(alpha * 255)
      ];
    }

    // ==========================================
    // Layer Proxy Methods
    // ==========================================

    getActiveLayer() {
      return this.layerManager.getActiveLayer();
    }

    setActiveLayer(index) {
      this.layerManager.setActiveLayer(index);
    }

    addLayer(name, width = this.width, height = this.height, fillType = 'transparent') {
      const layer = this.layerManager.addLayer(name, width, height, fillType);
      this.history.push(`Add Layer "${layer.name}"`);
      this.render();
      return layer;
    }

    deleteLayer(index = this.layerManager.activeLayerIndex) {
      const res = this.layerManager.deleteLayer(index);
      if (res) {
        this.history.push('Delete Layer');
        this.render();
      }
      return res;
    }

    duplicateLayer(index = this.layerManager.activeLayerIndex) {
      const layer = this.layerManager.duplicateLayer(index);
      if (layer) {
        this.history.push(`Duplicate Layer "${layer.name}"`);
        this.render();
      }
      return layer;
    }

    moveLayer(fromIndex, toIndex) {
      const res = this.layerManager.moveLayer(fromIndex, toIndex);
      if (res) {
        this.history.push('Reorder Layers');
        this.render();
      }
      return res;
    }

    mergeDown(index = this.layerManager.activeLayerIndex) {
      const res = this.layerManager.mergeDown(index);
      if (res) {
        this.history.push('Merge Down');
        this.render();
      }
      return res;
    }

    mergeVisible() {
      this.layerManager.mergeVisible();
      this.history.push('Merge Visible Layers');
      this.render();
    }

    flattenImage(bgColor = '#ffffff') {
      this.layerManager.flattenImage(bgColor);
      this.history.push('Flatten Image');
      this.render();
    }

    // ==========================================
    // Document Canvas Operations
    // ==========================================

    newDocument(width, height, fillType = 'white') {
      this.width = Math.max(1, Math.round(width));
      this.height = Math.max(1, Math.round(height));
      this.layerManager = new root.GIMP.LayerManager(this.width, this.height);
      this.layers = this.layerManager;
      this.layerManager.layers = [];
      this.layerManager.addLayer('Background', this.width, this.height, fillType);

      this.selection.clear();
      this.updateCanvasSize();
      this.history = new HistoryStack(this, 35);
      this.history.push('New Document');
      this.fitToWindow();
      this.render();
    }

    initCanvas(width, height, fillType = 'white') {
      this.newDocument(width, height, fillType);
    }

    scaleImage(newWidth, newHeight) {
      newWidth = Math.max(1, Math.round(newWidth));
      newHeight = Math.max(1, Math.round(newHeight));
      const oldW = this.width;
      const oldH = this.height;

      for (const layer of this.layerManager.layers) {
        const temp = document.createElement('canvas');
        temp.width = layer.width;
        temp.height = layer.height;
        temp.getContext('2d').drawImage(layer.canvas, 0, 0);

        const scaleX = newWidth / oldW;
        const scaleY = newHeight / oldH;

        layer.width = Math.max(1, Math.round(layer.width * scaleX));
        layer.height = Math.max(1, Math.round(layer.height * scaleY));
        layer.x = Math.round(layer.x * scaleX);
        layer.y = Math.round(layer.y * scaleY);

        layer.canvas.width = layer.width;
        layer.canvas.height = layer.height;
        layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
        layer.ctx.imageSmoothingEnabled = true;
        layer.ctx.imageSmoothingQuality = 'high';
        layer.ctx.drawImage(temp, 0, 0, layer.width, layer.height);
      }

      this.width = newWidth;
      this.height = newHeight;
      this.selection.clear();
      this.updateCanvasSize();
      this.history.push('Scale Image');
      this.render();
    }

    resizeCanvas(newWidth, newHeight, anchorX = 0.5, anchorY = 0.5) {
      newWidth = Math.max(1, Math.round(newWidth));
      newHeight = Math.max(1, Math.round(newHeight));
      if (this.width === newWidth && this.height === newHeight) return;

      this.width = newWidth;
      this.height = newHeight;
      this.layerManager.resize(newWidth, newHeight, anchorX, anchorY);
      this.updateCanvasSize();
      this.history.push('Resize Canvas');
      this.render();
    }

    crop(x, y, width, height) {
      width = Math.max(1, Math.round(width));
      height = Math.max(1, Math.round(height));

      // Crop each layer canvas
      for (const layer of this.layerManager.layers) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = width;
        cropCanvas.height = height;
        const cCtx = cropCanvas.getContext('2d');

        // Draw portion of layer into cropped canvas
        cCtx.drawImage(
          layer.canvas,
          x - layer.x,
          y - layer.y,
          width,
          height,
          0,
          0,
          width,
          height
        );

        layer.width = width;
        layer.height = height;
        layer.x = 0;
        layer.y = 0;
        layer.canvas.width = width;
        layer.canvas.height = height;
        layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
        layer.ctx.drawImage(cropCanvas, 0, 0);
      }

      this.width = width;
      this.height = height;
      this.selection.clear();
      this.updateCanvasSize();
      this.render();
    }

    flip(direction = 'horizontal') {
      const layer = this.getActiveLayer();
      if (!layer || layer.locked) return;

      const temp = document.createElement('canvas');
      temp.width = layer.width;
      temp.height = layer.height;
      const tCtx = temp.getContext('2d');
      tCtx.drawImage(layer.canvas, 0, 0);

      layer.ctx.save();
      layer.ctx.clearRect(0, 0, layer.width, layer.height);
      if (direction === 'horizontal') {
        layer.ctx.translate(layer.width, 0);
        layer.ctx.scale(-1, 1);
      } else {
        layer.ctx.translate(0, layer.height);
        layer.ctx.scale(1, -1);
      }
      layer.ctx.drawImage(temp, 0, 0);
      layer.ctx.restore();

      this.history.push(`Flip Layer ${direction}`);
      this.render();
    }

    flipImage(horizontal = false, vertical = false) {
      for (const layer of this.layerManager.layers) {
        if (layer.locked) continue;
        const temp = document.createElement('canvas');
        temp.width = layer.width;
        temp.height = layer.height;
        temp.getContext('2d').drawImage(layer.canvas, 0, 0);

        layer.ctx.save();
        layer.ctx.clearRect(0, 0, layer.width, layer.height);
        if (horizontal) {
          layer.ctx.translate(layer.width, 0);
          layer.ctx.scale(-1, 1);
        }
        if (vertical) {
          layer.ctx.translate(0, layer.height);
          layer.ctx.scale(1, -1);
        }
        layer.ctx.drawImage(temp, 0, 0);
        layer.ctx.restore();
      }
      this.history.push(`Flip Image ${horizontal ? 'Horizontally' : 'Vertically'}`);
      this.render();
    }

    rotateImage(degrees) {
      let deg = degrees % 360;
      if (deg < 0) deg += 360;

      const rad = (deg * Math.PI) / 180;
      const swapDims = deg === 90 || deg === 270;
      const oldW = this.width;
      const oldH = this.height;
      const newDocW = swapDims ? oldH : oldW;
      const newDocH = swapDims ? oldW : oldH;

      for (const layer of this.layerManager.layers) {
        if (layer.locked) continue;
        const temp = document.createElement('canvas');
        temp.width = layer.width;
        temp.height = layer.height;
        temp.getContext('2d').drawImage(layer.canvas, 0, 0);

        let newW = swapDims ? layer.height : layer.width;
        let newH = swapDims ? layer.width : layer.height;

        layer.width = newW;
        layer.height = newH;
        layer.canvas.width = newW;
        layer.canvas.height = newH;
        layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });

        layer.ctx.save();
        layer.ctx.translate(newW / 2, newH / 2);
        layer.ctx.rotate(rad);
        layer.ctx.drawImage(temp, -temp.width / 2, -temp.height / 2);
        layer.ctx.restore();
      }

      this.width = newDocW;
      this.height = newDocH;
      this.updateCanvasSize();
      this.history.push(`Rotate Image ${deg}°`);
      this.render();
    }

    rotate(angleDegrees) {
      const layer = this.getActiveLayer();
      if (!layer || layer.locked) return;

      const rad = (angleDegrees * Math.PI) / 180;
      const isOrthogonal = angleDegrees % 90 === 0;

      const temp = document.createElement('canvas');
      temp.width = layer.width;
      temp.height = layer.height;
      temp.getContext('2d').drawImage(layer.canvas, 0, 0);

      let newW = layer.width;
      let newH = layer.height;
      if (angleDegrees === 90 || angleDegrees === 270) {
        newW = layer.height;
        newH = layer.width;
      }

      layer.width = newW;
      layer.height = newH;
      layer.canvas.width = newW;
      layer.canvas.height = newH;
      layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });

      layer.ctx.save();
      layer.ctx.translate(newW / 2, newH / 2);
      layer.ctx.rotate(rad);
      layer.ctx.drawImage(temp, -temp.width / 2, -temp.height / 2);
      layer.ctx.restore();

      this.history.push(`Rotate Layer ${angleDegrees}°`);
      this.render();
    }

    // ==========================================
    // Clipboard Operations
    // ==========================================

    copy() {
      const layer = this.getActiveLayer();
      if (!layer) return false;

      const clipCanvas = document.createElement('canvas');
      clipCanvas.width = this.width;
      clipCanvas.height = this.height;
      const cCtx = clipCanvas.getContext('2d');

      if (this.selection && this.selection.active) {
        cCtx.save();
        this.selection.applyClip(cCtx);
        cCtx.drawImage(layer.canvas, layer.x, layer.y);
        cCtx.restore();
      } else {
        cCtx.drawImage(layer.canvas, layer.x, layer.y);
      }

      this.clipboard = {
        width: this.width,
        height: this.height,
        canvas: clipCanvas
      };
      return true;
    }

    cut() {
      if (this.copy()) {
        this.deleteSelection();
        this.history.push('Cut');
        return true;
      }
      return false;
    }

    paste() {
      if (!this.clipboard) return null;
      const newLayer = this.layerManager.addLayer('Pasted Layer', this.width, this.height, 'transparent');
      newLayer.ctx.drawImage(this.clipboard.canvas, 0, 0);
      this.history.push('Paste Layer');
      this.render();
      return newLayer;
    }

    deleteSelection() {
      const layer = this.getActiveLayer();
      if (!layer || layer.locked) return;

      layer.ctx.save();
      if (this.selection && this.selection.active) {
        this.selection.applyClip(layer.ctx);
        layer.ctx.clearRect(0, 0, layer.width, layer.height);
      } else {
        layer.clear();
      }
      layer.ctx.restore();

      this.history.push('Clear');
      this.render();
    }

    clearSelection() {
      this.deleteSelection();
    }

    fillSelection(color = this.fgColor) {
      const layer = this.getActiveLayer();
      if (!layer || layer.locked) return;

      layer.ctx.save();
      if (this.selection && this.selection.active) {
        this.selection.applyClip(layer.ctx);
      }
      layer.ctx.fillStyle = color;
      layer.ctx.fillRect(0, 0, layer.width, layer.height);
      layer.ctx.restore();

      this.history.push('Fill');
      this.render();
    }

    // ==========================================
    // Import & Export
    // ==========================================

    exportImage(format = 'image/png', quality = 0.92) {
      return this.compositeCanvas.toDataURL(format, quality);
    }

    downloadImage(filename = 'untitled.png', format = 'image/png', quality = 0.92) {
      const dataUrl = this.exportImage(format, quality);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    exportProjectJSON() {
      const project = {
        format: 'pixelforge-project',
        legacyFormat: 'web-gimp-project',
        version: '1.0',
        createdAt: new Date().toISOString(),
        canvas: {
          width: this.width,
          height: this.height
        },
        activeLayerIndex: this.layerManager.activeLayerIndex,
        layers: this.layerManager.serialize().layers
      };
      return JSON.stringify(project, null, 2);
    }

    saveProject(filename = 'project.pforge') {
      const json = this.exportProjectJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    async loadProjectJSON(jsonStringOrObj) {
      let data = jsonStringOrObj;
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }

      if (data.canvas) {
        this.width = data.canvas.width;
        this.height = data.canvas.height;
        this.updateCanvasSize();
      }

      await this.layerManager.deserialize({
        width: this.width,
        height: this.height,
        activeLayerIndex: data.activeLayerIndex || 0,
        layers: data.layers
      });

      this.selection.clear();
      this.history = new HistoryStack(this, 35);
      this.history.push('Load Project');
      this.fitToWindow();
      this.render();
    }

    async importImage(fileOrUrl, asNewLayer = false) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          if (asNewLayer) {
            const layer = this.addLayer(`Imported ${img.width}x${img.height}`, this.width, this.height, 'transparent');
            layer.ctx.drawImage(img, 0, 0);
            this.history.push('Import as Layer');
            this.render();
            resolve(layer);
          } else {
            this.newDocument(img.width, img.height, 'transparent');
            const bgLayer = this.getActiveLayer();
            bgLayer.ctx.drawImage(img, 0, 0);
            this.history.push('Open Image');
            this.render();
            resolve(bgLayer);
          }
        };
        img.onerror = reject;

        if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
          const reader = new FileReader();
          reader.onload = (e) => { img.src = e.target.result; };
          reader.onerror = reject;
          reader.readAsDataURL(fileOrUrl);
        } else {
          img.src = fileOrUrl;
        }
      });
    }

    // ==========================================
    // Tool Management & Input Handling
    // ==========================================

    setActiveTool(toolIdOrInstance) {
      let tool = toolIdOrInstance;
      const registry = root.PixelForge.ToolRegistry || root.GIMP.ToolRegistry;
      if (typeof tool === 'string' && registry) {
        // Map of descriptive logical tool names to tool registry IDs
        const TOOL_ALIAS_MAP = {
          'box-select': 'rect-select',
          'box area selector': 'rect-select',
          'oval-select': 'ellipse-select',
          'oval area selector': 'ellipse-select',
          'freeform-select': 'lasso',
          'freeform outline selector': 'lasso',
          'layer-shifter': 'move',
          'layer position shifter': 'move',
          'canvas-trimmer': 'crop',
          'canvas frame trimmer': 'crop',
          'smooth-painter': 'brush',
          'smooth blend painter': 'brush',
          'precision-writer': 'pencil',
          'precision pixel writer': 'pencil',
          'alpha-clearer': 'eraser',
          'alpha clearing tool': 'eraser',
          'area-flood': 'bucket',
          'contiguous area flood': 'bucket',
          'color-sampler': 'picker',
          'pixel color sampler': 'picker',
          'typography-rasterizer': 'text',
          'typography rasterizer': 'text',
          'canvas-magnifier': 'zoom',
          'canvas magnifier': 'zoom',
          'viewport-scroller': 'pan',
          'viewport canvas scroller': 'pan'
        };

        const normalized = tool.toLowerCase().trim();
        const mappedKey = TOOL_ALIAS_MAP[normalized] || normalized;
        tool = registry[mappedKey] || registry[tool];
      }
      if (!tool) return;

      if (this.activeTool && this.activeTool.deactivate) {
        this.activeTool.deactivate(this);
      }

      this.activeTool = tool;
      if (this.activeTool.activate) {
        this.activeTool.activate(this);
      }

      // Update cursor
      if (this.viewportContainer) {
        this.viewportContainer.style.cursor = tool.cursor || 'crosshair';
      }

      this.emit('toolChanged', { tool });
      this.renderOverlay();
    }

    setupToolEvents() {
      if (!this.overlayCanvas || this._toolEventsBound) return;
      this._toolEventsBound = true;

      const getCoords = (e) => this.screenToCanvas(e.clientX, e.clientY);

      this.overlayCanvas.addEventListener('pointerdown', (e) => {
        // When UIController is loaded, UIController handles unified viewport & canvas interaction
        if (typeof window !== 'undefined' && window.PixelForge && window.PixelForge.currentUI) return;
        const coords = getCoords(e);
        if (this.activeTool && this.activeTool.onPointerDown) {
          this.activeTool.onPointerDown(e, coords, this);
        }
      });

      window.addEventListener('pointermove', (e) => {
        if (typeof window !== 'undefined' && window.PixelForge && window.PixelForge.currentUI) return;
        const coords = getCoords(e);
        this.emit('cursorMoved', coords);
        this.renderRulers(coords);

        if (this.activeTool && this.activeTool.onPointerMove) {
          this.activeTool.onPointerMove(e, coords, this);
        }
      });

      window.addEventListener('pointerup', (e) => {
        if (typeof window !== 'undefined' && window.PixelForge && window.PixelForge.currentUI) return;
        const coords = getCoords(e);
        if (this.activeTool && this.activeTool.onPointerUp) {
          this.activeTool.onPointerUp(e, coords, this);
        }
      });

      window.addEventListener('keydown', (e) => {
        if (typeof window !== 'undefined' && window.PixelForge && window.PixelForge.currentUI) return;
        if (this.activeTool && this.activeTool.onKeyDown) {
          this.activeTool.onKeyDown(e, this);
        }
      });
    }

    // ==========================================
    // Rendering & Animation Loop
    // ==========================================

    render() {
      // 1. Composite all layers onto compositeCanvas
      this.layerManager.composite(this.compositeCtx);

      // 2. Blit to main display canvas
      this.mainCtx.clearRect(0, 0, this.width, this.height);
      this.mainCtx.drawImage(this.compositeCanvas, 0, 0);

      // 3. Render overlays (marching ants, tool guides)
      this.renderOverlay();

      this.emit('render');
    }

    renderOverlay() {
      this.overlayCtx.clearRect(0, 0, this.width, this.height);

      // Draw marching ants selection boundary
      if (this.selection && this.selection.active) {
        this.selection.drawMarchingAnts(this.overlayCtx);
      }

      // Draw active tool overlay
      if (this.activeTool && this.activeTool.drawOverlay) {
        this.activeTool.drawOverlay(this.overlayCtx, this);
      }
    }

    renderRulers(cursorCoords = null) {
      if (!this.showRulers) return;

      // Top horizontal ruler
      if (this.rulerTopCanvas) {
        const rTop = this.rulerTopCanvas;
        const ctxT = rTop.getContext('2d');
        const w = rTop.width = rTop.clientWidth || 800;
        const h = rTop.height = rTop.clientHeight || 18;

        ctxT.fillStyle = '#282828';
        ctxT.fillRect(0, 0, w, h);
        ctxT.fillStyle = '#888888';
        ctxT.font = '9px monospace';

        const step = Math.max(10, Math.round(50 / this.zoom));
        for (let x = 0; x <= this.width; x += step) {
          const screenPos = this.canvasToScreen(x, 0).x - this.viewportContainer.getBoundingClientRect().left;
          if (screenPos >= 0 && screenPos <= w) {
            ctxT.fillRect(screenPos, h - 6, 1, 6);
            ctxT.fillText(`${x}`, screenPos + 2, 9);
          }
        }

        if (cursorCoords) {
          const cX = this.canvasToScreen(cursorCoords.x, 0).x - this.viewportContainer.getBoundingClientRect().left;
          ctxT.fillStyle = '#4a82d0';
          ctxT.fillRect(cX, 0, 1, h);
        }
      }

      // Left vertical ruler
      if (this.rulerLeftCanvas) {
        const rLeft = this.rulerLeftCanvas;
        const ctxL = rLeft.getContext('2d');
        const w = rLeft.width = rLeft.clientWidth || 18;
        const h = rLeft.height = rLeft.clientHeight || 600;

        ctxL.fillStyle = '#282828';
        ctxL.fillRect(0, 0, w, h);
        ctxL.fillStyle = '#888888';
        ctxL.font = '9px monospace';

        const step = Math.max(10, Math.round(50 / this.zoom));
        for (let y = 0; y <= this.height; y += step) {
          const screenPos = this.canvasToScreen(0, y).y - this.viewportContainer.getBoundingClientRect().top;
          if (screenPos >= 0 && screenPos <= h) {
            ctxL.fillRect(w - 6, screenPos, 6, 1);
            ctxL.save();
            ctxL.translate(9, screenPos + 10);
            ctxL.rotate(-Math.PI / 2);
            ctxL.fillText(`${y}`, 0, 0);
            ctxL.restore();
          }
        }

        if (cursorCoords) {
          const cY = this.canvasToScreen(0, cursorCoords.y).y - this.viewportContainer.getBoundingClientRect().top;
          ctxL.fillStyle = '#4a82d0';
          ctxL.fillRect(0, cY, w, 1);
        }
      }
    }

    startRenderLoop() {
      let lastAntsTick = 0;
      const loop = (timestamp) => {
        // Redraw marching ants at ~20fps if selection is active
        if (this.selection && this.selection.active && timestamp - lastAntsTick > 50) {
          lastAntsTick = timestamp;
          this.renderOverlay();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  // Export classes to PixelForge and backward-compatible GIMP namespace
  root.PixelForge.SelectionModel = SelectionModel;
  root.PixelForge.HistoryStack = HistoryStack;
  root.PixelForge.Engine = GimpEngine;

  root.GIMP.SelectionModel = SelectionModel;
  root.GIMP.HistoryStack = HistoryStack;
  root.GIMP.Engine = GimpEngine;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SelectionModel, HistoryStack, GimpEngine, Engine: GimpEngine };
  }
})(typeof window !== 'undefined' ? window : globalThis);
