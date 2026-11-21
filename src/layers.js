/**
 * PixelForge Studio - Core Layer System
 * Provides Layer and LayerManager classes for multi-layer digital image editing.
 */

(function (root) {
  'use strict';

  root.PixelForge = root.PixelForge || {};
  root.GIMP = root.PixelForge; // Backward compatibility alias

  // Standard PixelForge to Canvas globalCompositeOperation mapping
  const BLEND_MODE_MAP = {
    'normal': 'source-over',
    'source-over': 'source-over',
    'multiply': 'multiply',
    'screen': 'screen',
    'overlay': 'overlay',
    'darken': 'darken',
    'lighten': 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    'difference': 'difference',
    'exclusion': 'exclusion',
    'hue': 'hue',
    'saturation': 'saturation',
    'color': 'color',
    'luminosity': 'luminosity',
    'destination-over': 'destination-over',
    'destination-out': 'destination-out',
    'source-atop': 'source-atop',
    'xor': 'xor'
  };

  /**
   * Helper to map user-friendly blend mode name to canvas globalCompositeOperation.
   */
  function mapBlendMode(mode) {
    if (!mode) return 'source-over';
    const normalized = String(mode).toLowerCase().trim().replace(/\s+/g, '-');
    return BLEND_MODE_MAP[normalized] || 'source-over';
  }

  /**
   * Generates a unique ID for layers.
   */
  function generateId() {
    return 'layer_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * Layer Class
   * Represents an individual image layer with its own canvas context, position, opacity, and blend mode.
   */
  class Layer {
    constructor(options = {}) {
      this.id = options.id || generateId();
      this.name = options.name || 'New Layer';
      this.width = Math.max(1, parseInt(options.width, 10) || 800);
      this.height = Math.max(1, parseInt(options.height, 10) || 600);
      this.x = parseInt(options.x, 10) || 0;
      this.y = parseInt(options.y, 10) || 0;
      this.visible = options.visible !== undefined ? !!options.visible : true;
      this.opacity = options.opacity !== undefined ? Math.max(0, Math.min(1, parseFloat(options.opacity))) : 1.0;
      this.blendMode = options.blendMode || 'normal';
      this.locked = !!options.locked;
      this.alphaLocked = !!options.alphaLocked;
      this.isTextLayer = options.isTextLayer !== undefined ? !!options.isTextLayer : !!(options.textData && options.textData.text);
      this.textData = options.textData ? JSON.parse(JSON.stringify(options.textData)) : null;

      // Create internal canvas
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      // Apply initial fill if requested
      if (options.fill) {
        this.fill(options.fill);
      } else if (options.initialImage) {
        this.drawImage(options.initialImage);
      }
    }

    /**
     * Clear all pixels in this layer canvas.
     */
    clear() {
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.ctx.restore();
    }

    /**
     * Fill the entire layer with a color.
     * @param {string} color CSS color string (e.g. '#ffffff', 'rgba(0,0,0,0)')
     */
    fill(color) {
      if (!color || color === 'transparent') {
        this.clear();
        return;
      }
      this.ctx.save();
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.restore();
    }

    /**
     * Draw an image or canvas onto this layer.
     */
    drawImage(img, dx = 0, dy = 0, dw = null, dh = null) {
      if (!img) return;
      this.ctx.save();
      if (this.alphaLocked) {
        this.ctx.globalCompositeOperation = 'source-atop';
      }
      if (dw !== null && dh !== null) {
        this.ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        this.ctx.drawImage(img, dx, dy);
      }
      this.ctx.restore();
    }

    /**
     * Get ImageData from the layer canvas.
     */
    getImageData(sx = 0, sy = 0, sw = this.width, sh = this.height) {
      return this.ctx.getImageData(sx, sy, sw, sh);
    }

    /**
     * Put ImageData onto the layer canvas.
     */
    putImageData(imageData, dx = 0, dy = 0) {
      if (!imageData) return;
      if (this.alphaLocked) {
        // When alpha locked, draw to temporary canvas and use source-atop
        const temp = document.createElement('canvas');
        temp.width = imageData.width;
        temp.height = imageData.height;
        const tempCtx = temp.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'source-atop';
        this.ctx.drawImage(temp, dx, dy);
        this.ctx.restore();
      } else {
        this.ctx.putImageData(imageData, dx, dy);
      }
    }

    /**
     * Resizes the layer canvas, preserving existing pixel data relative to anchor.
     * @param {number} newWidth 
     * @param {number} newHeight 
     * @param {number} anchorX 0 (left), 0.5 (center), 1 (right)
     * @param {number} anchorY 0 (top), 0.5 (middle), 1 (bottom)
     */
    resize(newWidth, newHeight, anchorX = 0, anchorY = 0) {
      newWidth = Math.max(1, Math.round(newWidth));
      newHeight = Math.max(1, Math.round(newHeight));
      if (this.width === newWidth && this.height === newHeight) return;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(this.canvas, 0, 0);

      const dx = Math.round((newWidth - this.width) * anchorX);
      const dy = Math.round((newHeight - this.height) * anchorY);

      this.width = newWidth;
      this.height = newHeight;
      this.canvas.width = newWidth;
      this.canvas.height = newHeight;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      this.ctx.clearRect(0, 0, newWidth, newHeight);
      this.ctx.drawImage(tempCanvas, dx, dy);
    }

    /**
     * Expands or crops layer canvas to match document image boundaries, resetting (x, y) to (0, 0).
     * @param {number} docWidth 
     * @param {number} docHeight 
     */
    toImageSize(docWidth, docHeight) {
      if (this.width === docWidth && this.height === docHeight && this.x === 0 && this.y === 0) return;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.width;
      tempCanvas.height = this.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(this.canvas, 0, 0);

      this.width = docWidth;
      this.height = docHeight;
      this.canvas.width = docWidth;
      this.canvas.height = docHeight;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

      this.ctx.clearRect(0, 0, docWidth, docHeight);
      this.ctx.drawImage(tempCanvas, this.x, this.y);
      this.x = 0;
      this.y = 0;
    }

    /**
     * Re-renders text content if this layer contains text metadata.
     */
    renderText(textData = null) {
      if (textData) {
        this.textData = Object.assign({}, this.textData || {}, textData);
      }
      if (!this.textData || !this.textData.text) return;
      this.isTextLayer = true;

      this.clear();
      this.ctx.save();
      const td = this.textData;
      const fontSize = parseInt(td.fontSize, 10) || 28;
      const style = `${td.italic ? 'italic ' : ''}${td.bold ? 'bold ' : ''}${fontSize}px ${td.fontFamily || 'sans-serif'}`;
      this.ctx.font = style;
      this.ctx.fillStyle = td.color || '#000000';
      this.ctx.textBaseline = 'top';

      const lines = String(td.text).split('\n');
      const lineHeight = Math.round(fontSize * 1.25);
      const startX = td.x !== undefined ? td.x : 20;
      const startY = td.y !== undefined ? td.y : 20;

      for (let i = 0; i < lines.length; i++) {
        this.ctx.fillText(lines[i], startX, startY + (i * lineHeight));
      }
      this.ctx.restore();
    }

    /**
     * Deep clone this layer.
     */
    clone() {
      const cloned = new Layer({
        name: this.name + ' (Copy)',
        width: this.width,
        height: this.height,
        x: this.x,
        y: this.y,
        visible: this.visible,
        opacity: this.opacity,
        blendMode: this.blendMode,
        locked: this.locked,
        alphaLocked: this.alphaLocked,
        isTextLayer: !!this.isTextLayer,
        textData: this.textData ? JSON.parse(JSON.stringify(this.textData)) : null
      });
      cloned.ctx.drawImage(this.canvas, 0, 0);
      return cloned;
    }

    /**
     * Export layer as Data URL.
     */
    toDataURL(type = 'image/png', quality = 1.0) {
      return this.canvas.toDataURL(type, quality);
    }

    /**
     * Generates a thumbnail canvas or DataURL for UI docks.
     */
    getThumbnail(thumbWidth = 48, thumbHeight = 48) {
      const thumb = document.createElement('canvas');
      thumb.width = thumbWidth;
      thumb.height = thumbHeight;
      const tCtx = thumb.getContext('2d');

      // Draw mini checkerboard background for transparent pixels
      const size = 6;
      for (let y = 0; y < thumbHeight; y += size) {
        for (let x = 0; x < thumbWidth; x += size) {
          tCtx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#4a4a4a' : '#333333';
          tCtx.fillRect(x, y, size, size);
        }
      }

      // Draw aspect-ratio scaled layer image
      const scale = Math.min(thumbWidth / this.width, thumbHeight / this.height);
      const dw = this.width * scale;
      const dh = this.height * scale;
      const dx = (thumbWidth - dw) / 2;
      const dy = (thumbHeight - dh) / 2;

      tCtx.drawImage(this.canvas, dx, dy, dw, dh);
      return thumb.toDataURL('image/png');
    }

    /**
     * Serialize layer to JSON-friendly object.
     */
    serialize() {
      return {
        id: this.id,
        name: this.name,
        width: this.width,
        height: this.height,
        x: this.x,
        y: this.y,
        visible: this.visible,
        opacity: this.opacity,
        blendMode: this.blendMode,
        locked: this.locked,
        alphaLocked: this.alphaLocked,
        isTextLayer: !!this.isTextLayer,
        textData: this.textData ? JSON.parse(JSON.stringify(this.textData)) : null,
        dataUrl: this.toDataURL('image/png')
      };
    }

    /**
     * Deserialize layer from serialized object.
     */
    static async deserialize(data) {
      const layer = new Layer({
        id: data.id,
        name: data.name,
        width: data.width,
        height: data.height,
        x: data.x,
        y: data.y,
        visible: data.visible,
        opacity: data.opacity,
        blendMode: data.blendMode,
        locked: data.locked,
        alphaLocked: data.alphaLocked,
        isTextLayer: data.isTextLayer,
        textData: data.textData
      });

      if (data.dataUrl) {
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            layer.ctx.drawImage(img, 0, 0);
            resolve();
          };
          img.onerror = reject;
          img.src = data.dataUrl;
        });
      }

      return layer;
    }
  }

  /**
   * LayerManager Class
   * Manages the stack of layers (index 0 = bottom layer, index N-1 = top layer).
   */
  class LayerManager {
    constructor(width = 800, height = 600) {
      this.width = width;
      this.height = height;
      this.layers = [];
      this.activeLayerIndex = -1;
      this.listeners = new Map();
      this.engine = null;

      // Start with a default Background layer
      this.addLayer('Background', width, height, 'white');
    }

    /**
     * Event listener subscription.
     */
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
          console.error(`Error in LayerManager event [${event}]:`, err);
        }
      }
    }

    /**
     * Get active layer.
     */
    getActiveLayer() {
      if (!this.layers || this.layers.length === 0) return null;
      if (this.activeLayerIndex < 0 || this.activeLayerIndex >= this.layers.length) {
        this.activeLayerIndex = Math.max(0, this.layers.length - 1);
      }
      return this.layers[this.activeLayerIndex];
    }

    /**
     * Set active layer by index.
     */
    setActiveLayer(index) {
      if (index >= 0 && index < this.layers.length) {
        this.activeLayerIndex = index;
        this.emit('activeLayerChanged', { index, layer: this.layers[index] });
        this.emit('layerSelected', { index, layer: this.layers[index] });
        this.emit('changed');
      }
    }

    /**
     * Set active layer by ID.
     */
    setActiveLayerById(id) {
      const idx = this.layers.findIndex(l => l.id === id);
      if (idx !== -1) {
        this.setActiveLayer(idx);
      }
    }

    /**
     * Add a new layer to the stack.
     * @param {string} name 
     * @param {number} width 
     * @param {number} height 
     * @param {string} fillType 'transparent' | 'white' | 'black' | 'color'
     * @param {number} insertIndex optional index; defaults to directly above current active layer
     */
    addLayer(name = 'New Layer', width = this.width, height = this.height, fillType = 'transparent', insertIndex = -1) {
      const layer = new Layer({
        name,
        width,
        height
      });

      if (fillType === 'white') {
        layer.fill('#ffffff');
      } else if (fillType === 'black') {
        layer.fill('#000000');
      } else if (fillType && fillType !== 'transparent') {
        layer.fill(fillType);
      }

      if (insertIndex >= 0 && insertIndex <= this.layers.length) {
        this.layers.splice(insertIndex, 0, layer);
        this.activeLayerIndex = insertIndex;
      } else if (this.activeLayerIndex >= 0 && this.activeLayerIndex < this.layers.length) {
        // Insert right above the currently active layer
        this.layers.splice(this.activeLayerIndex + 1, 0, layer);
        this.activeLayerIndex++;
      } else {
        this.layers.push(layer);
        this.activeLayerIndex = this.layers.length - 1;
      }

      this.emit('layerAdded', { layer, index: this.activeLayerIndex });
      this.emit('changed');
      return layer;
    }

    /**
     * Delete layer at specified index.
     */
    deleteLayer(index = this.activeLayerIndex) {
      if (this.layers.length <= 1) {
        console.warn('Cannot delete the only remaining layer.');
        return false;
      }
      if (index < 0 || index >= this.layers.length) return false;

      const removed = this.layers.splice(index, 1)[0];
      if (this.activeLayerIndex >= this.layers.length) {
        this.activeLayerIndex = this.layers.length - 1;
      }

      this.emit('layerDeleted', { layer: removed, index });
      this.emit('activeLayerChanged', { index: this.activeLayerIndex, layer: this.getActiveLayer() });
      this.emit('changed');
      return true;
    }

    /**
     * Duplicate layer at specified index.
     */
    duplicateLayer(index = this.activeLayerIndex) {
      if (index < 0 || index >= this.layers.length) return null;
      const target = this.layers[index];
      const cloned = target.clone();
      cloned.name = target.name + ' Copy';

      this.layers.splice(index + 1, 0, cloned);
      this.activeLayerIndex = index + 1;

      this.emit('layerDuplicated', { layer: cloned, index: this.activeLayerIndex });
      this.emit('changed');
      return cloned;
    }

    /**
     * Move layer from old index to new index.
     */
    moveLayer(fromIndex, toIndex) {
      if (fromIndex < 0 || fromIndex >= this.layers.length) return false;
      if (toIndex < 0 || toIndex >= this.layers.length) return false;
      if (fromIndex === toIndex) return true;

      const layer = this.layers.splice(fromIndex, 1)[0];
      this.layers.splice(toIndex, 0, layer);
      this.activeLayerIndex = toIndex;

      this.emit('layerMoved', { layer, fromIndex, toIndex });
      this.emit('changed');
      return true;
    }

    raiseLayer(index = this.activeLayerIndex) {
      if (index < this.layers.length - 1) {
        return this.moveLayer(index, index + 1);
      }
      return false;
    }

    lowerLayer(index = this.activeLayerIndex) {
      if (index > 0) {
        return this.moveLayer(index, index - 1);
      }
      return false;
    }

    layerToTop(index = this.activeLayerIndex) {
      return this.moveLayer(index, this.layers.length - 1);
    }

    layerToBottom(index = this.activeLayerIndex) {
      return this.moveLayer(index, 0);
    }

    /**
     * Merge layer down onto the layer below it.
     */
    mergeDown(index = this.activeLayerIndex) {
      if (index <= 0 || index >= this.layers.length) {
        console.warn('Cannot merge down bottom layer or invalid index.');
        return false;
      }

      const upperLayer = this.layers[index];
      const lowerLayer = this.layers[index - 1];

      // Draw upper layer onto lower layer with upper layer's opacity and blend mode
      lowerLayer.ctx.save();
      lowerLayer.ctx.globalAlpha = upperLayer.opacity;
      lowerLayer.ctx.globalCompositeOperation = mapBlendMode(upperLayer.blendMode);
      lowerLayer.ctx.drawImage(upperLayer.canvas, upperLayer.x - lowerLayer.x, upperLayer.y - lowerLayer.y);
      lowerLayer.ctx.restore();

      // Remove the upper layer
      this.layers.splice(index, 1);
      this.activeLayerIndex = index - 1;

      this.emit('layerMerged', { index: this.activeLayerIndex, targetLayer: lowerLayer });
      this.emit('changed');
      return true;
    }

    /**
     * Merge all visible layers into a single layer.
     */
    mergeVisible() {
      if (this.layers.length <= 1) return;

      const mergedCanvas = document.createElement('canvas');
      mergedCanvas.width = this.width;
      mergedCanvas.height = this.height;
      const mCtx = mergedCanvas.getContext('2d');

      this.composite(mCtx);

      const mergedLayer = new Layer({
        name: 'Visible Merged',
        width: this.width,
        height: this.height
      });
      mergedLayer.ctx.drawImage(mergedCanvas, 0, 0);

      // Keep invisible layers, remove all visible layers, replace with mergedLayer
      const newLayers = [];
      let inserted = false;
      for (const layer of this.layers) {
        if (!layer.visible) {
          newLayers.push(layer);
        } else if (!inserted) {
          newLayers.push(mergedLayer);
          inserted = true;
        }
      }
      if (!inserted) newLayers.push(mergedLayer);

      this.layers = newLayers;
      this.activeLayerIndex = this.layers.indexOf(mergedLayer);

      this.emit('layersMerged');
      this.emit('changed');
    }

    /**
     * Flatten image: merges everything onto an opaque background layer.
     */
    flattenImage(bgColor = '#ffffff') {
      const flatCanvas = document.createElement('canvas');
      flatCanvas.width = this.width;
      flatCanvas.height = this.height;
      const fCtx = flatCanvas.getContext('2d');

      // Fill background
      fCtx.fillStyle = bgColor;
      fCtx.fillRect(0, 0, this.width, this.height);

      // Composite visible layers
      this.composite(fCtx);

      const flatLayer = new Layer({
        name: 'Background',
        width: this.width,
        height: this.height
      });
      flatLayer.ctx.drawImage(flatCanvas, 0, 0);

      this.layers = [flatLayer];
      this.activeLayerIndex = 0;

      this.emit('imageFlattened');
      this.emit('changed');
    }

    setOpacity(index, opacity) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].opacity = Math.max(0, Math.min(1, parseFloat(opacity)));
        this.emit('changed');
      }
    }

    setBlendMode(index, mode) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].blendMode = mode;
        this.emit('changed');
      }
    }

    toggleVisibility(index) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].visible = !this.layers[index].visible;
        this.emit('changed');
      }
    }

    setVisibility(index, visible) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].visible = !!visible;
        this.emit('changed');
      }
    }

    setLayerLock(index, locked) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].locked = !!locked;
        this.emit('changed');
      }
    }

    setAlphaLock(index, alphaLocked) {
      if (index >= 0 && index < this.layers.length) {
        this.layers[index].alphaLocked = !!alphaLocked;
        this.emit('changed');
      }
    }

    getLayerById(id) {
      return this.layers.find(l => l.id === id) || null;
    }

    renameLayer(layerIdOrIndex, newName) {
      if (!newName || !String(newName).trim()) return false;
      let layer = null;
      let idx = -1;
      if (typeof layerIdOrIndex === 'number') {
        idx = layerIdOrIndex;
        layer = this.layers[idx];
      } else if (typeof layerIdOrIndex === 'string') {
        idx = this.layers.findIndex(l => l.id === layerIdOrIndex);
        if (idx === -1) {
          idx = this.layers.findIndex(l => l.name === layerIdOrIndex);
        }
        if (idx !== -1) layer = this.layers[idx];
      } else if (layerIdOrIndex && layerIdOrIndex.id) {
        idx = this.layers.findIndex(l => l.id === layerIdOrIndex.id);
        if (idx !== -1) layer = this.layers[idx];
      }

      if (!layer) {
        idx = this.activeLayerIndex;
        layer = this.getActiveLayer();
      }
      if (!layer) return false;

      const oldName = layer.name;
      const cleanName = String(newName).trim();
      if (oldName === cleanName) return true;

      layer.name = cleanName;
      this.emit('layerRenamed', { layer, index: idx, oldName, newName: cleanName });
      this.emit('changed');

      if (this.engine && this.engine.history && !this._suppressHistory) {
        this.engine.history.push(`Rename Layer: "${oldName}" -> "${cleanName}"`);
        if (this.engine.render) this.engine.render();
      }
      return true;
    }

    /**
     * Resizes all layers according to document resize.
     */
    resize(newWidth, newHeight, anchorX = 0, anchorY = 0) {
      this.width = newWidth;
      this.height = newHeight;
      for (const layer of this.layers) {
        layer.resize(newWidth, newHeight, anchorX, anchorY);
      }
      this.emit('changed');
    }

    /**
     * Composite all visible layers onto the target 2D context.
     * @param {CanvasRenderingContext2D} targetCtx 
     * @param {Object} options 
     */
    composite(targetCtx, options = {}) {
      if (!targetCtx) return;

      const w = options.width || this.width;
      const h = options.height || this.height;

      if (options.clear !== false) {
        targetCtx.clearRect(0, 0, w, h);
      }

      for (let i = 0; i < this.layers.length; i++) {
        const layer = this.layers[i];
        if (!layer.visible || layer.opacity <= 0) continue;

        targetCtx.save();
        targetCtx.globalAlpha = layer.opacity;
        targetCtx.globalCompositeOperation = mapBlendMode(layer.blendMode);

        targetCtx.drawImage(
          layer.canvas,
          layer.x,
          layer.y
        );

        targetCtx.restore();
      }
    }

    /**
     * Serialize full layer stack for project JSON or history snapshot.
     */
    serialize() {
      return {
        width: this.width,
        height: this.height,
        activeLayerIndex: this.activeLayerIndex,
        layers: this.layers.map(layer => layer.serialize())
      };
    }

    /**
     * Restore layer stack from serialized snapshot.
     */
    async deserialize(data) {
      if (!data || !Array.isArray(data.layers)) return;

      this.width = data.width || this.width;
      this.height = data.height || this.height;

      const loadedLayers = [];
      for (const layerData of data.layers) {
        const layer = await Layer.deserialize(layerData);
        loadedLayers.push(layer);
      }

      this.layers = loadedLayers;
      this.activeLayerIndex = Math.max(0, Math.min(this.layers.length - 1, data.activeLayerIndex || 0));
      this.emit('changed');
    }
  }

  // Export classes to PixelForge and backward-compatible GIMP namespace
  root.PixelForge.Layer = Layer;
  root.PixelForge.LayerManager = LayerManager;
  root.PixelForge.mapBlendMode = mapBlendMode;

  root.GIMP.Layer = Layer;
  root.GIMP.LayerManager = LayerManager;
  root.GIMP.mapBlendMode = mapBlendMode;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Layer, LayerManager, mapBlendMode };
  }
})(typeof window !== 'undefined' ? window : globalThis);
