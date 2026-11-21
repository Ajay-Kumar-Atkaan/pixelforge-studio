/**
 * PixelForge Studio - Main UI Controller & Desktop Shell
 * Manages menus, docks, tool options, layers list, history stack,
 * interactive dialogs with live previews, rulers, and keyboard shortcuts.
 */

(function (global) {
  'use strict';

  // Export to PixelForge namespace (aliased to GIMP for backward compatibility)
  global.PixelForge = global.PixelForge || global.GIMP || {};
  global.GIMP = global.PixelForge;

  class UIController {
    constructor() {
      this.engine = null;
      this.activeTool = null;
      this.activeMenu = null;
      this.marchingAntsOffset = 0;
      this.animFrameId = null;
    }

    /**
     * Initializes the entire UI shell and connects to the PixelForge Engine.
     */
    init(engine) {
      this.engine = engine;
      // Normalization aliases between LayerManager & Engine
      this.engine.layers = this.engine.layerManager || this.engine.layers;
      if (!this.engine.initCanvas) {
        this.engine.initCanvas = (w, h, fill) => this.engine.newDocument(w, h, fill);
      }
      if (!this.engine.rotateImage) {
        this.engine.rotateImage = (deg) => this.engine.rotate(deg);
      }
      if (!this.engine.flipImage) {
        this.engine.flipImage = (horiz, vert) => {
          if (horiz) this.engine.flip('horizontal');
          if (vert) this.engine.flip('vertical');
        };
      }
      if (!this.engine.clearSelection) {
        this.engine.clearSelection = () => this.engine.deleteSelection();
      }
      global.PixelForge.currentEngine = engine;
      global.GIMP.currentEngine = engine;
      global.PixelForge.currentUI = this;
      global.GIMP.currentUI = this;
      this.canvasViewport = document.getElementById('canvas-scroll-container') || document.body;

      this.initMenuBar();
      this.initToolbox();
      this.initColorControls();
      this.initLayersDock();
      this.initHistoryDock();
      this.initViewportEvents();
      this.initRulers();
      this.initStatusBar();
      this.initKeyboardShortcuts();
      this.initFileInputs();
      this.startMarchingAntsLoop();

      // Activate default Smooth Blend Painter tool
      this.selectTool('brush');

      // Sync layer UI whenever engine or layers change
      if (this.engine.layers) {
        this.engine.layers.on('changed', () => this.updateLayersList());
        this.engine.layers.on('layerSelected', () => this.updateLayersList());
        this.engine.layers.on('activeLayerChanged', () => this.updateLayersList());
      }
      if (this.engine.history) {
        this.engine.history.on('changed', () => this.updateHistoryList());
      }
      if (this.engine.on) {
        this.engine.on('zoomChanged', (data) => this.updateZoomDisplay(data.zoom));
        this.engine.on('viewportChanged', () => this.drawRulers());
        this.engine.on('docResized', () => {
          this.updateDocInfo();
          this.drawRulers();
        });
      }

      this.updateLayersList();
      this.updateHistoryList();
      this.updateDocInfo();
      this.engine.fitToWindow();
      this.engine.render();

      this.showToast('Welcome to PixelForge Studio! Ready to create.', 'info');
    }

    // =========================================================================
    // Menu Bar
    // =========================================================================

    initMenuBar() {
      const menuBar = document.getElementById('menu-bar');
      const menuItems = document.querySelectorAll('.menu-item');

      // Click to toggle menu dropdowns
      menuItems.forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = item.classList.contains('open');
          this.closeAllMenus();
          if (!isOpen) {
            item.classList.add('open');
            this.activeMenu = item;
          }
        });

        // Hover across menus once one is open
        item.addEventListener('mouseenter', () => {
          if (this.activeMenu && this.activeMenu !== item) {
            this.closeAllMenus();
            item.classList.add('open');
            this.activeMenu = item;
          }
        });
      });

      // Close menu when clicking outside
      document.addEventListener('click', () => {
        this.closeAllMenus();
      });

      // Menu actions dispatch
      document.querySelectorAll('.menu-action').forEach((action) => {
        action.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeAllMenus();

          const actionName = action.dataset.action;
          const toolName = action.dataset.tool;

          if (toolName) {
            this.selectTool(toolName);
          } else if (actionName) {
            this.handleMenuAction(actionName);
          }
        });
      });
    }

    closeAllMenus() {
      document.querySelectorAll('.menu-item.open').forEach((el) => el.classList.remove('open'));
      this.activeMenu = null;
    }

    handleMenuAction(action) {
      switch (action) {
        // File
        case 'new-image':
          this.showNewImageDialog();
          break;
        case 'open-image':
          document.getElementById('file-open-input').click();
          break;
        case 'open-as-layer':
          document.getElementById('layer-open-input').click();
          break;
        case 'save-project':
          this.engine.saveProject('project.pforge');
          this.showToast('Saved project as .pforge JSON', 'success');
          break;
        case 'export-image':
          this.showExportDialog();
          break;
        case 'close-image':
          const isInteractive = typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.navigator.webdriver;
          if (!isInteractive || window.confirm('Close current document? Unsaved changes will be lost.')) {
            this.engine.initCanvas(800, 600, '#ffffff');
            this.showToast('Canvas reset to blank', 'info');
          }
          break;

        // Edit
        case 'undo':
          if (this.engine.history.canUndo()) {
            this.engine.history.undo();
            this.showToast('Undo', 'info');
          }
          break;
        case 'redo':
          if (this.engine.history.canRedo()) {
            this.engine.history.redo();
            this.showToast('Redo', 'info');
          }
          break;
        case 'cut':
          this.engine.cut();
          this.showToast('Cut selected pixels', 'info');
          break;
        case 'copy':
          this.engine.copy();
          this.showToast('Copied to clipboard', 'info');
          break;
        case 'paste':
          this.engine.paste();
          this.showToast('Pasted as new layer', 'success');
          break;
        case 'fill-fg':
          this.engine.fillSelection(this.engine.fgColor);
          break;
        case 'fill-bg':
          this.engine.fillSelection(this.engine.bgColor);
          break;
        case 'clear-selection':
          this.engine.clearSelection();
          break;

        // Select
        case 'select-all':
          this.engine.selection.selectAll();
          this.engine.history.push('Select All');
          this.engine.render();
          this.engine.renderOverlay();
          break;
        case 'select-none':
          this.engine.selection.clear();
          this.engine.history.push('Deselect All');
          this.engine.render();
          this.engine.renderOverlay();
          break;
        case 'select-invert':
          this.engine.selection.invert();
          this.engine.history.push('Invert Selection');
          this.engine.render();
          this.engine.renderOverlay();
          break;

        // View
        case 'zoom-in':
          this.engine.setZoom(this.engine.zoom * 1.25);
          break;
        case 'zoom-out':
          this.engine.setZoom(this.engine.zoom * 0.8);
          break;
        case 'zoom-100':
          this.engine.setZoom(1.0);
          break;
        case 'zoom-fit':
          this.engine.fitToWindow();
          break;
        case 'toggle-fullscreen':
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
          break;

        // Image
        case 'canvas-size':
          this.showCanvasSizeDialog();
          break;
        case 'scale-image':
          this.showScaleImageDialog();
          break;
        case 'flip-horiz':
          this.engine.flipImage(true, false);
          this.showToast('Flipped image horizontally', 'info');
          break;
        case 'flip-vert':
          this.engine.flipImage(false, true);
          this.showToast('Flipped image vertically', 'info');
          break;
        case 'rotate-90-cw':
          this.engine.rotateImage(90);
          this.showToast('Rotated 90° CW', 'info');
          break;
        case 'rotate-90-ccw':
          this.engine.rotateImage(-90);
          this.showToast('Rotated 90° CCW', 'info');
          break;
        case 'rotate-180':
          this.engine.rotateImage(180);
          this.showToast('Rotated 180°', 'info');
          break;
        case 'flatten-image':
          this.engine.flattenImage(this.engine.bgColor);
          this.showToast('Flattened image to single layer', 'info');
          break;

        // Layer
        case 'new-layer':
          this.showNewLayerDialog();
          break;
        case 'duplicate-layer':
          if (this.engine.duplicateLayer) this.engine.duplicateLayer();
          else if (this.engine.layers && this.engine.layers.duplicateLayer) this.engine.layers.duplicateLayer();
          this.engine.render();
          this.updateLayersList();
          break;
        case 'delete-layer':
          if (this.engine.deleteLayer) this.engine.deleteLayer();
          else if (this.engine.layers && this.engine.layers.deleteLayer) this.engine.layers.deleteLayer();
          this.engine.render();
          this.updateLayersList();
          break;
        case 'raise-layer':
          if (this.engine.layers && this.engine.layers.raiseLayer) {
            this.engine.layers.raiseLayer();
            this.engine.history.push('Raise Layer');
            this.engine.render();
          }
          this.updateLayersList();
          break;
        case 'lower-layer':
          if (this.engine.layers && this.engine.layers.lowerLayer) {
            this.engine.layers.lowerLayer();
            this.engine.history.push('Lower Layer');
            this.engine.render();
          }
          this.updateLayersList();
          break;
        case 'merge-down':
          if (this.engine.mergeDown) this.engine.mergeDown();
          else if (this.engine.layers && this.engine.layers.mergeDown) this.engine.layers.mergeDown();
          this.engine.render();
          this.updateLayersList();
          break;
        case 'merge-visible':
          if (this.engine.mergeVisible) this.engine.mergeVisible();
          else if (this.engine.layers && this.engine.layers.mergeVisible) this.engine.layers.mergeVisible();
          this.engine.render();
          this.updateLayersList();
          break;
        case 'layer-to-image-size':
          const activeLayer = this.engine.getActiveLayer();
          if (activeLayer) {
            if (activeLayer.toImageSize) {
              activeLayer.toImageSize(this.engine.width, this.engine.height);
            } else {
              activeLayer.width = this.engine.width;
              activeLayer.height = this.engine.height;
              activeLayer.x = 0;
              activeLayer.y = 0;
              activeLayer.canvas.width = this.engine.width;
              activeLayer.canvas.height = this.engine.height;
            }
            this.engine.history.push('Layer to Canvas Size');
            this.engine.render();
            this.updateLayersList();
          }
          break;

        // Filters / Color Adjustments
        case 'filter-brightness-contrast':
          this.showBrightnessContrastDialog();
          break;
        case 'filter-exposure':
          this.showExposureDialog();
          break;
        case 'filter-hue-saturation':
          this.showHueSaturationDialog();
          break;
        case 'filter-levels':
          this.showLevelsDialog();
          break;
        case 'filter-invert':
          this.applyDirectFilter('invert', 'Invert Colors');
          break;
        case 'filter-desaturate':
          this.showDesaturateDialog();
          break;
        case 'filter-sepia':
          this.showSepiaDialog();
          break;
        case 'filter-gaussian-blur':
          this.showGaussianBlurDialog();
          break;
        case 'filter-sharpen':
          this.showSharpenDialog();
          break;
        case 'filter-edge-detect':
          this.showEdgeDetectDialog();
          break;
        case 'filter-noise':
          this.showNoiseDialog();
          break;
        case 'filter-pixelize':
          this.showPixelizeDialog();
          break;
        case 'filter-vignette':
          this.showVignetteDialog();
          break;

        // Help
        case 'help-shortcuts':
          this.showShortcutsDialog();
          break;
        case 'help-about':
          this.showAboutDialog();
          break;

        default:
          console.warn('Unhandled menu action:', action);
      }
    }

    // =========================================================================
    // Toolbox & Tool Options
    // =========================================================================

    initToolbox() {
      const toolbox = document.getElementById('toolbox');
      if (!toolbox) return;

      toolbox.querySelectorAll('.tool-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const toolId = btn.dataset.tool;
          this.selectTool(toolId);
        });
      });
    }

    selectTool(toolId) {
      const registry = (global.PixelForge && global.PixelForge.ToolRegistry) || (global.GIMP && global.GIMP.ToolRegistry);
      const tool = registry ? registry[toolId] : null;
      if (!tool) {
        console.warn('Tool not found:', toolId);
        return;
      }

      if (this.activeTool && this.activeTool.deactivate) {
        this.activeTool.deactivate(this.engine);
      }

      this.activeTool = tool;
      this.engine.activeTool = tool;

      if (tool.activate) {
        tool.activate(this.engine);
      }
      this.engine.renderOverlay();

      // Update toolbox button UI
      document.querySelectorAll('#toolbox .tool-btn').forEach((btn) => {
        if (btn.dataset.tool === toolId) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Update Tool Options Header & Content
      const titleEl = document.getElementById('tool-options-title');
      if (titleEl) {
        titleEl.textContent = `${tool.name} Options`;
      }

      const container = document.getElementById('tool-options-container');
      if (container && tool.renderOptions) {
        tool.renderOptions(container, () => {
          this.engine.renderOverlay();
        });
      }

      // Update viewport cursor
      const scrollContainer = document.getElementById('canvas-scroll-container');
      const overlayCanvas = document.getElementById('overlay-canvas');
      const mainCanvas = document.getElementById('main-canvas');
      const cursorVal = tool.cursor || 'crosshair';
      if (scrollContainer) scrollContainer.style.cursor = cursorVal;
      if (overlayCanvas) overlayCanvas.style.cursor = cursorVal;
      if (mainCanvas) mainCanvas.style.cursor = cursorVal;

      // Update status message
      this.setStatusMessage(`${tool.name}: ${tool.shortcut ? `(${tool.shortcut}) ` : ''}active`);
      this.engine.renderOverlay();
    }

    // =========================================================================
    // Color Swatches
    // =========================================================================

    initColorControls() {
      const fgSwatch = document.getElementById('fg-swatch');
      const bgSwatch = document.getElementById('bg-swatch');
      const swapBtn = document.getElementById('swap-color-btn');
      const resetBtn = document.getElementById('reset-color-btn');
      const hiddenPicker = document.getElementById('hidden-color-picker');

      let pickTarget = 'fg';

      if (fgSwatch) {
        fgSwatch.style.backgroundColor = this.engine.fgColor;
        fgSwatch.addEventListener('click', () => {
          pickTarget = 'fg';
          hiddenPicker.value = this.engine.fgColor;
          hiddenPicker.click();
        });
      }

      if (bgSwatch) {
        bgSwatch.style.backgroundColor = this.engine.bgColor;
        bgSwatch.addEventListener('click', () => {
          pickTarget = 'bg';
          hiddenPicker.value = this.engine.bgColor;
          hiddenPicker.click();
        });
      }

      if (hiddenPicker) {
        hiddenPicker.addEventListener('input', (e) => {
          if (pickTarget === 'fg') {
            this.engine.setFgColor(e.target.value);
            if (fgSwatch) fgSwatch.style.backgroundColor = e.target.value;
          } else {
            this.engine.setBgColor(e.target.value);
            if (bgSwatch) bgSwatch.style.backgroundColor = e.target.value;
          }
        });
      }

      if (swapBtn) {
        swapBtn.addEventListener('click', () => {
          const temp = this.engine.fgColor;
          this.engine.setFgColor(this.engine.bgColor);
          this.engine.setBgColor(temp);
          if (fgSwatch) fgSwatch.style.backgroundColor = this.engine.fgColor;
          if (bgSwatch) bgSwatch.style.backgroundColor = this.engine.bgColor;
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.engine.setFgColor('#000000');
          this.engine.setBgColor('#ffffff');
          if (fgSwatch) fgSwatch.style.backgroundColor = '#000000';
          if (bgSwatch) bgSwatch.style.backgroundColor = '#ffffff';
        });
      }

      if (this.engine && this.engine.on) {
        this.engine.on('colorChanged', (data) => {
          if (fgSwatch && data && data.fgColor) fgSwatch.style.backgroundColor = data.fgColor;
          if (bgSwatch && data && data.bgColor) bgSwatch.style.backgroundColor = data.bgColor;
        });
      }
    }

    // =========================================================================
    // Right Dock (Layers, Channels, History)
    // =========================================================================

    initLayersDock() {
      // Tab switching
      document.querySelectorAll('.dock-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.dock-tab').forEach((t) => t.classList.remove('active'));
          document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

          tab.classList.add('active');
          const paneId = `pane-${tab.dataset.tab}`;
          const pane = document.getElementById(paneId);
          if (pane) pane.classList.add('active');
        });
      });

      // Layer Blend Mode Select
      const blendSelect = document.getElementById('layer-blend-select');
      if (blendSelect) {
        blendSelect.addEventListener('change', (e) => {
          const activeLayer = this.engine.getActiveLayer();
          if (activeLayer) {
            this.engine.layers.setBlendMode(this.engine.layers.activeLayerIndex, e.target.value);
            this.engine.history.push('Layer Blend Mode');
            this.engine.render();
          }
        });
      }

      // Layer Opacity Slider
      const opacitySlider = document.getElementById('layer-opacity-slider');
      const opacityVal = document.getElementById('layer-opacity-val');
      if (opacitySlider) {
        opacitySlider.addEventListener('input', (e) => {
          const val = Number(e.target.value);
          if (opacityVal) opacityVal.textContent = `${val}%`;
          const activeLayer = this.engine.getActiveLayer();
          if (activeLayer) {
            this.engine.layers.setOpacity(this.engine.layers.activeLayerIndex, val / 100);
            this.engine.render();
          }
        });
        opacitySlider.addEventListener('change', () => {
          this.engine.history.push('Layer Opacity');
        });
      }

      // Layer Buttons Footer
      document.getElementById('btn-new-layer')?.addEventListener('click', () => this.handleMenuAction('new-layer'));
      document.getElementById('btn-raise-layer')?.addEventListener('click', () => this.handleMenuAction('raise-layer'));
      document.getElementById('btn-lower-layer')?.addEventListener('click', () => this.handleMenuAction('lower-layer'));
      document.getElementById('btn-duplicate-layer')?.addEventListener('click', () => this.handleMenuAction('duplicate-layer'));
      document.getElementById('btn-merge-down')?.addEventListener('click', () => this.handleMenuAction('merge-down'));
      document.getElementById('btn-delete-layer')?.addEventListener('click', () => this.handleMenuAction('delete-layer'));
    }

    syncLayerDockHeader() {
      if (!this.engine || !this.engine.layers) return;
      const layers = this.engine.layers.layers;
      const activeIdx = this.engine.layers.activeLayerIndex;
      const activeLayer = layers[activeIdx];
      if (activeLayer) {
        const blendSelect = document.getElementById('layer-blend-select');
        const opacitySlider = document.getElementById('layer-opacity-slider');
        const opacityVal = document.getElementById('layer-opacity-val');

        if (blendSelect) blendSelect.value = activeLayer.blendMode || 'normal';
        if (opacitySlider) opacitySlider.value = Math.round((activeLayer.opacity ?? 1) * 100);
        if (opacityVal) opacityVal.textContent = `${Math.round((activeLayer.opacity ?? 1) * 100)}%`;
      }
    }

    updateLayersList() {
      const container = document.getElementById('layer-list-container');
      if (!container || !this.engine.layers) return;
      if (this.isRenamingLayer) return;

      container.innerHTML = '';

      const layers = this.engine.layers.layers;
      const activeIdx = this.engine.layers.activeLayerIndex;

      // Update mode & opacity controls to reflect currently active layer
      this.syncLayerDockHeader();

      // Display in reverse order (top layer first in UI list, bottom layer at bottom)
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const item = document.createElement('div');
        item.className = `layer-item ${i === activeIdx ? 'active' : ''}`;
        item.dataset.layerIndex = i;

        // Visibility Toggle Eye
        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'layer-vis-btn';
        eyeBtn.innerHTML = layer.visible ? '👁' : '<span style="opacity:0.3;">👁</span>';
        eyeBtn.title = layer.visible ? 'Hide Layer' : 'Show Layer';
        eyeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.engine.layers.toggleVisibility(i);
          this.engine.render();
          eyeBtn.innerHTML = layer.visible ? '👁' : '<span style="opacity:0.3;">👁</span>';
          eyeBtn.title = layer.visible ? 'Hide Layer' : 'Show Layer';
        });

        // Layer Thumbnail
        const thumb = document.createElement('canvas');
        thumb.className = 'layer-thumb';
        thumb.width = 32;
        thumb.height = 24;
        const tCtx = thumb.getContext('2d');
        if (layer.canvas) {
          tCtx.drawImage(layer.canvas, 0, 0, 32, 24);
        }

        // Layer Name Label
        const nameLabel = document.createElement('span');
        nameLabel.className = 'layer-name';
        nameLabel.textContent = layer.name;
        nameLabel.title = 'Double click to rename';

        // Double click to rename
        const startRename = (e) => {
          if (e) {
            e.stopPropagation();
            e.preventDefault();
          }
          if (item.querySelector('.layer-name-input')) return;
          this.isRenamingLayer = true;

          const currentName = layer.name;
          const input = document.createElement('input');
          input.type = 'text';
          input.className = 'layer-name-input';
          input.value = currentName;

          item.replaceChild(input, nameLabel);
          input.focus();
          input.select();

          let committed = false;
          const commitRename = () => {
            if (committed) return;
            committed = true;
            this.isRenamingLayer = false;
            const val = input.value.trim();
            if (val && val !== currentName) {
              if (this.engine.renameLayer) {
                this.engine.renameLayer(i, val);
              } else {
                this.engine.layers.renameLayer(i, val);
              }
            }
            this.updateLayersList();
          };

          const cancelRename = () => {
            if (committed) return;
            committed = true;
            this.isRenamingLayer = false;
            this.updateLayersList();
          };

          input.addEventListener('click', (ev) => ev.stopPropagation());
          input.addEventListener('dblclick', (ev) => ev.stopPropagation());
          input.addEventListener('pointerdown', (ev) => ev.stopPropagation());
          input.addEventListener('mousedown', (ev) => ev.stopPropagation());

          input.addEventListener('blur', commitRename);
          input.addEventListener('keydown', (ke) => {
            ke.stopPropagation();
            if (ke.key === 'Enter') {
              ke.preventDefault();
              commitRename();
            } else if (ke.key === 'Escape') {
              ke.preventDefault();
              cancelRename();
            }
          });
        };

        nameLabel.addEventListener('dblclick', startRename);
        item.addEventListener('dblclick', (e) => {
          if (e.target.closest('.layer-vis-btn') || e.target.closest('.layer-name-input')) return;
          startRename(e);
        });

        // Click item to activate layer (non-destructive in-place state update)
        item.addEventListener('click', (e) => {
          if (e.target.closest('.layer-vis-btn') || e.target.closest('.layer-name-input')) return;
          if (this.engine.layers.activeLayerIndex !== i) {
            this.engine.layers.setActiveLayer(i);
            container.querySelectorAll('.layer-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            this.syncLayerDockHeader();
          }
        });

        item.appendChild(eyeBtn);
        item.appendChild(thumb);
        item.appendChild(nameLabel);
        container.appendChild(item);
      }
    }

    // =========================================================================
    // History Dock
    // =========================================================================

    initHistoryDock() {
      // History changes are observed via engine.history.on('changed')
    }

    updateHistoryList() {
      const container = document.getElementById('history-list-container');
      if (!container || !this.engine.history) return;

      container.innerHTML = '';
      const stack = this.engine.history.getStack();
      const currentIdx = this.engine.history.currentIndex;

      stack.forEach((step, idx) => {
        const item = document.createElement('div');
        item.className = `history-item ${idx === currentIdx ? 'active' : ''} ${idx > currentIdx ? 'undone' : ''}`;
        item.innerHTML = `
          <span>${idx === 0 ? '📁' : '⚡'}</span>
          <span>${step.description || `Step ${idx}`}</span>
        `;
        item.addEventListener('click', () => {
          this.engine.history.jumpTo(idx);
          this.engine.render();
          this.updateHistoryList();
        });
        container.appendChild(item);
      });

      // Scroll active item into view
      const activeEl = container.querySelector('.history-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }

    // =========================================================================
    // Viewport & Pointer Events
    // =========================================================================

    initViewportEvents() {
      const scrollContainer = document.getElementById('canvas-scroll-container');
      const overlayCanvas = document.getElementById('overlay-canvas');
      const mainCanvas = document.getElementById('main-canvas');
      const canvasWrapper = document.getElementById('canvas-wrapper');
      if (!scrollContainer || !overlayCanvas) return;

      let isSpacePanning = false;
      let panStart = null;

      // Temporary spacebar panning
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          isSpacePanning = true;
          scrollContainer.classList.add('pan-mode');
        }
      });
      window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
          isSpacePanning = false;
          scrollContainer.classList.remove('pan-mode');
          scrollContainer.classList.remove('panning');
          panStart = null;
        }
      });

      // Dual pointer & mouse interaction handlers with deduplication
      let lastDownTimestamp = 0;
      let lastMoveTimestamp = 0;
      let lastUpTimestamp = 0;

      const handleCanvasPointerDown = (e) => {
        const now = Date.now();
        if (now - lastDownTimestamp < 35 && e.type === 'mousedown') return;
        lastDownTimestamp = now;

        if (isSpacePanning || e.button === 1) {
          panStart = { x: e.clientX, y: e.clientY };
          scrollContainer.classList.add('panning');
          return;
        }

        if (e.button !== 0) return;

        try {
          if (e.target && e.target.setPointerCapture && e.pointerId !== undefined) {
            e.target.setPointerCapture(e.pointerId);
          }
        } catch (err) {}

        const coords = this.engine.screenToCanvas(e.clientX, e.clientY);
        if (this.activeTool && this.activeTool.onPointerDown) {
          this.activeTool.onPointerDown(e, coords, this.engine);
        }
      };

      overlayCanvas.addEventListener('pointerdown', handleCanvasPointerDown);
      overlayCanvas.addEventListener('mousedown', handleCanvasPointerDown);
      mainCanvas.addEventListener('pointerdown', handleCanvasPointerDown);
      mainCanvas.addEventListener('mousedown', handleCanvasPointerDown);

      if (canvasWrapper) {
        canvasWrapper.addEventListener('pointerdown', (e) => {
          if (e.target === canvasWrapper) handleCanvasPointerDown(e);
        });
        canvasWrapper.addEventListener('mousedown', (e) => {
          if (e.target === canvasWrapper) handleCanvasPointerDown(e);
        });
      }

      const handlePointerMove = (e) => {
        const now = Date.now();
        if (now - lastMoveTimestamp < 20 && e.type === 'mousemove') return;
        lastMoveTimestamp = now;

        if (panStart) {
          const dx = e.clientX - panStart.x;
          const dy = e.clientY - panStart.y;
          this.engine.panBy(dx, dy);
          panStart = { x: e.clientX, y: e.clientY };
          return;
        }

        const coords = this.engine.screenToCanvas(e.clientX, e.clientY);
        this.updateCursorCoords(coords);

        if (this.activeTool && this.activeTool.onPointerMove) {
          this.activeTool.onPointerMove(e, coords, this.engine);
        }

        this.updateRulerGuides(coords);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('mousemove', handlePointerMove);

      const handlePointerUp = (e) => {
        const now = Date.now();
        if (now - lastUpTimestamp < 35 && e.type === 'mouseup') return;
        lastUpTimestamp = now;

        if (panStart) {
          panStart = null;
          scrollContainer.classList.remove('panning');
          return;
        }

        try {
          if (e.target && e.target.hasPointerCapture && e.pointerId !== undefined && e.target.hasPointerCapture(e.pointerId)) {
            e.target.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}

        const coords = this.engine.screenToCanvas(e.clientX, e.clientY);
        if (this.activeTool && this.activeTool.onPointerUp) {
          this.activeTool.onPointerUp(e, coords, this.engine);
        }
      };

      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('mouseup', handlePointerUp);

      // Mouse wheel zoom / pan
      scrollContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          // Zoom
          const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
          const coords = this.engine.screenToCanvas(e.clientX, e.clientY);
          this.engine.setZoom(this.engine.zoom * zoomFactor, coords);
        } else {
          // Pan
          this.engine.panBy(-e.deltaX, -e.deltaY);
        }
      }, { passive: false });
    }

    // =========================================================================
    // Rulers & Guidelines
    // =========================================================================

    initRulers() {
      this.drawRulers();
      window.addEventListener('resize', () => this.drawRulers());
    }

    drawRulers() {
      const rh = document.getElementById('ruler-h');
      const rv = document.getElementById('ruler-v');
      if (!rh || !rv || !this.engine) return;

      const topBox = rh.parentElement.getBoundingClientRect();
      const leftBox = rv.parentElement.getBoundingClientRect();

      rh.width = topBox.width;
      rh.height = topBox.height;
      rv.width = leftBox.width;
      rv.height = leftBox.height;

      const ctxH = rh.getContext('2d');
      const ctxV = rv.getContext('2d');

      ctxH.fillStyle = '#262626';
      ctxH.fillRect(0, 0, rh.width, rh.height);
      ctxV.fillStyle = '#262626';
      ctxV.fillRect(0, 0, rv.width, rv.height);

      ctxH.strokeStyle = '#555555';
      ctxH.fillStyle = '#888888';
      ctxH.font = '9px monospace';

      ctxV.strokeStyle = '#555555';
      ctxV.fillStyle = '#888888';
      ctxV.font = '9px monospace';

      const zoom = this.engine.zoom;
      const step = zoom > 2 ? 50 : (zoom < 0.5 ? 200 : 100);

      // Horizontal ruler
      for (let x = 0; x <= this.engine.width; x += step) {
        const screenPos = this.engine.canvasToScreen(x, 0);
        const rx = screenPos.x - topBox.left;
        if (rx >= 0 && rx <= rh.width) {
          ctxH.beginPath();
          ctxH.moveTo(rx, rh.height - 8);
          ctxH.lineTo(rx, rh.height);
          ctxH.stroke();
          ctxH.fillText(`${x}`, rx + 2, rh.height - 4);
        }
      }

      // Vertical ruler
      for (let y = 0; y <= this.engine.height; y += step) {
        const screenPos = this.engine.canvasToScreen(0, y);
        const ry = screenPos.y - leftBox.top;
        if (ry >= 0 && ry <= rv.height) {
          ctxV.beginPath();
          ctxV.moveTo(rv.width - 8, ry);
          ctxV.lineTo(rv.width, ry);
          ctxV.stroke();
          ctxV.save();
          ctxV.translate(rv.width - 4, ry + 12);
          ctxV.rotate(-Math.PI / 2);
          ctxV.fillText(`${y}`, 0, 0);
          ctxV.restore();
        }
      }
    }

    updateRulerGuides(coords) {
      // Guide tick updates on rulers
    }

    // =========================================================================
    // Marching Ants Animation Loop
    // =========================================================================

    startMarchingAntsLoop() {
      const renderLoop = () => {
        if (this.engine && this.engine.selection && this.engine.selection.active) {
          this.marchingAntsOffset = (this.marchingAntsOffset + 0.5) % 8;
          this.engine.renderOverlay(this.marchingAntsOffset);
        }
        this.animFrameId = requestAnimationFrame(renderLoop);
      };
      this.animFrameId = requestAnimationFrame(renderLoop);
    }

    // =========================================================================
    // Status Bar
    // =========================================================================

    initStatusBar() {
      const zoomSelect = document.getElementById('zoom-select');
      if (zoomSelect) {
        zoomSelect.addEventListener('change', (e) => {
          const val = e.target.value;
          if (val === 'fit') {
            this.engine.fitToWindow();
          } else {
            this.engine.setZoom(Number(val));
          }
        });
      }
    }

    updateCursorCoords(coords) {
      const el = document.getElementById('status-coords');
      if (el) {
        const x = Math.round(coords.x);
        const y = Math.round(coords.y);
        el.textContent = `(${x}, ${y}) px`;
      }
    }

    updateDocInfo() {
      const dimsEl = document.getElementById('status-dims');
      const docInfoEl = document.getElementById('doc-info-text');
      if (dimsEl && this.engine) {
        dimsEl.textContent = `${this.engine.width} × ${this.engine.height} px`;
      }
      if (docInfoEl && this.engine) {
        docInfoEl.textContent = `${this.engine.width} × ${this.engine.height} px — RGB Color`;
      }
    }

    setStatusMessage(msg) {
      const el = document.getElementById('status-message');
      if (el) el.textContent = msg;
    }

    updateZoomDisplay(zoom) {
      const sel = document.getElementById('zoom-select');
      if (sel) {
        let found = false;
        for (const opt of sel.options) {
          if (Math.abs(Number(opt.value) - zoom) < 0.05) {
            opt.selected = true;
            found = true;
            break;
          }
        }
        if (!found) {
          sel.value = '';
        }
      }
    }

    // =========================================================================
    // Keyboard Shortcuts
    // =========================================================================

    initKeyboardShortcuts() {
      window.addEventListener('keydown', (e) => {
        // Skip hotkeys if focused on input / textarea
        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return;
        }

        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const key = e.key.toLowerCase();

        // Pass keydown to active tool first (e.g. crop Enter, text Enter)
        if (this.activeTool && this.activeTool.onKeyDown) {
          this.activeTool.onKeyDown(e, this.engine);
        }

        // Global hotkeys
        if (ctrl) {
          switch (key) {
            case 'z':
              e.preventDefault();
              if (shift) this.handleMenuAction('redo');
              else this.handleMenuAction('undo');
              break;
            case 'y':
              e.preventDefault();
              this.handleMenuAction('redo');
              break;
            case 'n':
              e.preventDefault();
              this.handleMenuAction('new-image');
              break;
            case 'o':
              e.preventDefault();
              this.handleMenuAction('open-image');
              break;
            case 's':
              e.preventDefault();
              this.handleMenuAction('save-project');
              break;
            case 'e':
              if (shift) {
                e.preventDefault();
                this.handleMenuAction('export-image');
              }
              break;
            case 'a':
              e.preventDefault();
              if (shift) this.handleMenuAction('select-none');
              else this.handleMenuAction('select-all');
              break;
            case 'i':
              e.preventDefault();
              this.handleMenuAction('select-invert');
              break;
            case 'c':
              e.preventDefault();
              this.handleMenuAction('copy');
              break;
            case 'x':
              e.preventDefault();
              this.handleMenuAction('cut');
              break;
            case 'v':
              e.preventDefault();
              this.handleMenuAction('paste');
              break;
            case ',':
              e.preventDefault();
              this.handleMenuAction('fill-fg');
              break;
            case '.':
              e.preventDefault();
              this.handleMenuAction('fill-bg');
              break;
          }
        } else {
          // Tool hotkeys without ctrl
          switch (key) {
            case 'p':
              this.selectTool('brush');
              break;
            case 'n':
              this.selectTool('pencil');
              break;
            case 'e':
              if (shift) this.selectTool('eraser');
              else this.selectTool('ellipse-select');
              break;
            case 'b':
              if (shift) this.selectTool('bucket');
              break;
            case 'o':
              this.selectTool('picker');
              break;
            case 'r':
              this.selectTool('rect-select');
              break;
            case 'f':
              this.selectTool('lasso');
              break;
            case 'm':
              this.selectTool('move');
              break;
            case 'c':
              if (shift) this.selectTool('crop');
              break;
            case 't':
              this.selectTool('text');
              break;
            case 'z':
              this.selectTool('zoom');
              break;
            case 'h':
              this.selectTool('pan');
              break;
            case 'x':
              // Swap FG/BG
              document.getElementById('swap-color-btn')?.click();
              break;
            case 'd':
              // Default FG/BG
              document.getElementById('reset-color-btn')?.click();
              break;
            case 'delete':
            case 'backspace':
              e.preventDefault();
              this.handleMenuAction('clear-selection');
              break;
            case '[':
              // Decrease brush size
              this.adjustBrushSize(-5);
              break;
            case ']':
              // Increase brush size
              this.adjustBrushSize(5);
              break;
            case '+':
            case '=':
              this.handleMenuAction('zoom-in');
              break;
            case '-':
              this.handleMenuAction('zoom-out');
              break;
            case '1':
              this.handleMenuAction('zoom-100');
              break;
            case '?':
            case 'f1':
              e.preventDefault();
              this.showShortcutsDialog();
              break;
            case 'escape':
              this.closeModals();
              if (this.engine.selection) {
                this.engine.selection.clear();
                this.engine.renderOverlay();
              }
              break;
          }
        }
      });
    }

    adjustBrushSize(delta) {
      if (this.activeTool && this.activeTool.options && this.activeTool.options.size !== undefined) {
        this.activeTool.options.size = Math.max(1, Math.min(300, this.activeTool.options.size + delta));
        const container = document.getElementById('tool-options-container');
        if (container) this.activeTool.renderOptions(container);
        this.engine.renderOverlay();
      }
    }

    // =========================================================================
    // File Open Inputs
    // =========================================================================

    initFileInputs() {
      const openInput = document.getElementById('file-open-input');
      const layerInput = document.getElementById('layer-open-input');

      if (openInput) {
        openInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;

          if (file.name.endsWith('.pforge') || file.name.endsWith('.wgimp') || file.type === 'application/json') {
            const reader = new FileReader();
            reader.onload = (event) => {
              this.engine.loadProjectJSON(event.target.result);
              this.showToast(`Opened project ${file.name}`, 'success');
            };
            reader.readAsText(file);
          } else {
            this.engine.importImage(file, false);
            this.showToast(`Opened ${file.name}`, 'success');
          }
          openInput.value = '';
        });
      }

      if (layerInput) {
        layerInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (!file) return;
          this.engine.importImage(file, true);
          this.showToast(`Opened ${file.name} as new layer`, 'success');
          layerInput.value = '';
        });
      }
    }

    // =========================================================================
    // Modal & Dialog Management
    // =========================================================================

    createModal(title, bodyContent, onConfirm, onCancel, options = {}) {
      this.closeModals();

      const modalContainer = document.getElementById('modal-container');
      if (!modalContainer) return;

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop open';

      const dialog = document.createElement('div');
      dialog.className = 'pf-dialog gimp-dialog';
      if (options.width) dialog.style.width = options.width;

      dialog.innerHTML = `
        <div class="dialog-header">
          <span class="dialog-title">${title}</span>
          <button class="dialog-close-btn">&times;</button>
        </div>
        <div class="dialog-body"></div>
        <div class="dialog-footer">
          <div class="footer-left"></div>
          <button class="dialog-cancel-btn">Cancel</button>
          <button class="dialog-ok-btn active">OK</button>
        </div>
      `;

      const bodyEl = dialog.querySelector('.dialog-body');
      if (typeof bodyContent === 'string') {
        bodyEl.innerHTML = bodyContent;
      } else if (bodyContent instanceof HTMLElement) {
        bodyEl.appendChild(bodyContent);
      }

      const close = () => {
        backdrop.remove();
        if (onCancel) onCancel();
      };

      dialog.querySelector('.dialog-close-btn').onclick = close;
      dialog.querySelector('.dialog-cancel-btn').onclick = close;
      dialog.querySelector('.dialog-ok-btn').onclick = () => {
        if (onConfirm) {
          const result = onConfirm(dialog);
          if (result !== false) backdrop.remove();
        } else {
          backdrop.remove();
        }
      };

      // Close on clicking backdrop outside dialog
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
      });

      backdrop.appendChild(dialog);
      modalContainer.appendChild(backdrop);
      return dialog;
    }

    closeModals() {
      document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
    }

    // =========================================================================
    // Interactive Filter Dialogs with Live Preview
    // =========================================================================

    showFilterDialog({ title, filterName, defaultOptions, controls, formatPreview }) {
      const layer = this.engine.getActiveLayer();
      if (!layer) {
        this.showToast('No active layer selected', 'error');
        return;
      }

      const origImageData = layer.ctx.getImageData(0, 0, layer.width, layer.height);
      const currentOpts = Object.assign({}, defaultOptions);
      let previewEnabled = true;

      const body = document.createElement('div');

      const previewRow = document.createElement('div');
      previewRow.className = 'dialog-row';
      previewRow.innerHTML = `
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="dlg-preview-cb" checked>
          <span>Preview live on canvas</span>
        </label>
      `;
      body.appendChild(previewRow);

      const updatePreview = () => {
        if (!previewEnabled) {
          layer.ctx.putImageData(origImageData, 0, 0);
          this.engine.render();
          return;
        }

        const copy = new ImageData(new Uint8ClampedArray(origImageData.data), layer.width, layer.height);
        const filters = (global.PixelForge && global.PixelForge.Filters) || (global.GIMP && global.GIMP.Filters);
        if (filters && filters[filterName]) {
          filters[filterName](copy, currentOpts);
          layer.ctx.putImageData(copy, 0, 0);
          this.engine.render();
        }
      };

      controls.forEach((ctrl) => {
        const row = document.createElement('div');
        row.className = 'dialog-row';
        row.innerHTML = `
          <label>${ctrl.label}:</label>
          <div class="control-group">
            <input type="range" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step || 1}" value="${currentOpts[ctrl.key]}">
            <input type="number" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step || 1}" value="${currentOpts[ctrl.key]}">
          </div>
        `;
        const range = row.querySelector('input[type="range"]');
        const num = row.querySelector('input[type="number"]');

        const syncVal = (v) => {
          v = Number(v);
          currentOpts[ctrl.key] = v;
          range.value = v;
          num.value = v;
          updatePreview();
        };

        range.addEventListener('input', (e) => syncVal(e.target.value));
        num.addEventListener('change', (e) => syncVal(e.target.value));
        body.appendChild(row);
      });

      const cb = previewRow.querySelector('#dlg-preview-cb');
      cb.addEventListener('change', (e) => {
        previewEnabled = e.target.checked;
        updatePreview();
      });

      updatePreview();

      this.createModal(
        title,
        body,
        () => {
          layer.ctx.putImageData(origImageData, 0, 0);
          const filters = (global.PixelForge && global.PixelForge.Filters) || (global.GIMP && global.GIMP.Filters);
          if (filters && filters.applyFilterToLayer) {
            filters.applyFilterToLayer(layer, filterName, currentOpts, this.engine.selection && this.engine.selection.active ? this.engine.selection.getMaskData() : null);
          }
          this.engine.history.push(title);
          this.engine.render();
          this.showToast(`Applied ${title}`, 'success');
        },
        () => {
          layer.ctx.putImageData(origImageData, 0, 0);
          this.engine.render();
        }
      );
    }

    applyDirectFilter(filterName, title) {
      const layer = this.engine.getActiveLayer();
      if (!layer) return;
      const filters = (global.PixelForge && global.PixelForge.Filters) || (global.GIMP && global.GIMP.Filters);
      if (filters && filters.applyFilterToLayer) {
        filters.applyFilterToLayer(layer, filterName, {}, this.engine.selection && this.engine.selection.active ? this.engine.selection.getMaskData() : null);
        this.engine.history.push(title);
        this.engine.render();
        this.showToast(`Applied ${title}`, 'success');
      }
    }

    // Specific filter dialogs
    showBrightnessContrastDialog() {
      this.showFilterDialog({
        title: 'Brightness & Contrast',
        filterName: 'brightnessContrast',
        defaultOptions: { brightness: 0, contrast: 0 },
        controls: [
          { label: 'Brightness', key: 'brightness', min: -100, max: 100 },
          { label: 'Contrast', key: 'contrast', min: -100, max: 100 }
        ]
      });
    }

    showExposureDialog() {
      this.showFilterDialog({
        title: 'Exposure (EV)',
        filterName: 'exposure',
        defaultOptions: { exposure: 0.0 },
        controls: [
          { label: 'Exposure (EV)', key: 'exposure', min: -3.0, max: 3.0, step: 0.1 }
        ]
      });
    }

    showHueSaturationDialog() {
      this.showFilterDialog({
        title: 'Hue, Saturation & Lightness',
        filterName: 'hueSaturation',
        defaultOptions: { hue: 0, saturation: 0, lightness: 0 },
        controls: [
          { label: 'Hue Degree', key: 'hue', min: -180, max: 180 },
          { label: 'Lightness', key: 'lightness', min: -100, max: 100 },
          { label: 'Saturation', key: 'saturation', min: -100, max: 100 }
        ]
      });
    }

    showLevelsDialog() {
      this.showFilterDialog({
        title: 'Histogram Levels',
        filterName: 'levels',
        defaultOptions: { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
        controls: [
          { label: 'Input Black Point', key: 'inBlack', min: 0, max: 253 },
          { label: 'Input White Point', key: 'inWhite', min: 2, max: 255 },
          { label: 'Gamma Exponent', key: 'gamma', min: 0.1, max: 5.0, step: 0.1 },
          { label: 'Output Black Point', key: 'outBlack', min: 0, max: 255 },
          { label: 'Output White Point', key: 'outWhite', min: 0, max: 255 }
        ]
      });
    }

    showGaussianBlurDialog() {
      this.showFilterDialog({
        title: 'Gaussian Spatial Blur',
        filterName: 'gaussianBlur',
        defaultOptions: { radius: 5 },
        controls: [
          { label: 'Blur Radius (px)', key: 'radius', min: 1, max: 50 }
        ]
      });
    }

    showSharpenDialog() {
      this.showFilterDialog({
        title: 'Unsharp Sharpening Mask',
        filterName: 'sharpen',
        defaultOptions: { amount: 1.0 },
        controls: [
          { label: 'Sharpening Strength', key: 'amount', min: 0.1, max: 5.0, step: 0.1 }
        ]
      });
    }

    showEdgeDetectDialog() {
      this.showFilterDialog({
        title: 'Sobel Edge Contour Detection',
        filterName: 'sobel',
        defaultOptions: { amount: 1.0, invert: false },
        controls: [
          { label: 'Edge Intensity', key: 'amount', min: 0.5, max: 5.0, step: 0.1 }
        ]
      });
    }

    showNoiseDialog() {
      this.showFilterDialog({
        title: 'Color Dispersion Noise',
        filterName: 'noise',
        defaultOptions: { amount: 25, monochromatic: true },
        controls: [
          { label: 'Noise Dispersion', key: 'amount', min: 1, max: 100 }
        ]
      });
    }

    showPixelizeDialog() {
      this.showFilterDialog({
        title: 'Pixelize Mosaic Grid',
        filterName: 'pixelize',
        defaultOptions: { size: 10 },
        controls: [
          { label: 'Mosaic Cell Size (px)', key: 'size', min: 2, max: 64 }
        ]
      });
    }

    showVignetteDialog() {
      this.showFilterDialog({
        title: 'Radial Edge Vignette',
        filterName: 'vignette',
        defaultOptions: { radius: 0.8, softness: 0.45 },
        controls: [
          { label: 'Vignette Radius', key: 'radius', min: 0.1, max: 1.5, step: 0.05 },
          { label: 'Edge Softness', key: 'softness', min: 0.1, max: 1.0, step: 0.05 }
        ]
      });
    }

    showDesaturateDialog() {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="dialog-row">
          <label>Desaturation Formula:</label>
          <select id="desat-mode">
            <option value="luminance">Luminance (Rec. 709)</option>
            <option value="lightness">Lightness</option>
            <option value="average">Channel Average</option>
          </select>
        </div>
      `;
      this.createModal('Desaturate to Grayscale', content, () => {
        const mode = content.querySelector('#desat-mode').value;
        const layer = this.engine.getActiveLayer();
        const filters = (global.PixelForge && global.PixelForge.Filters) || (global.GIMP && global.GIMP.Filters);
        if (layer && filters) {
          filters.applyFilterToLayer(layer, 'desaturate', { mode });
          this.engine.history.push('Desaturate');
          this.engine.render();
        }
      });
    }

    showSepiaDialog() {
      this.showFilterDialog({
        title: 'Warm Sepia Tone',
        filterName: 'sepia',
        defaultOptions: { amount: 100 },
        controls: [
          { label: 'Sepia Warmth (%)', key: 'amount', min: 1, max: 100 }
        ]
      });
    }

    // =========================================================================
    // Core Application Dialogs
    // =========================================================================

    showNewImageDialog() {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="dialog-row">
          <label>Width (px):</label>
          <input type="number" id="new-w" value="800" min="1" max="8192">
        </div>
        <div class="dialog-row">
          <label>Height (px):</label>
          <input type="number" id="new-h" value="600" min="1" max="8192">
        </div>
        <div class="dialog-row">
          <label>Initial Canvas Fill:</label>
          <select id="new-fill">
            <option value="#ffffff">Opaque White</option>
            <option value="transparent">Transparent Alpha</option>
            <option value="fg">Foreground Color</option>
            <option value="bg">Background Color</option>
          </select>
        </div>
      `;

      this.createModal('Create New Canvas Document', content, () => {
        const w = parseInt(content.querySelector('#new-w').value, 10) || 800;
        const h = parseInt(content.querySelector('#new-h').value, 10) || 600;
        let fill = content.querySelector('#new-fill').value;
        if (fill === 'fg') fill = this.engine.fgColor;
        if (fill === 'bg') fill = this.engine.bgColor;

        this.engine.initCanvas(w, h, fill);
        this.updateDocInfo();
        this.drawRulers();
        this.showToast(`Created new canvas ${w} × ${h} px`, 'success');
      });
    }

    showCanvasSizeDialog() {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="dialog-row">
          <label>New Width (px):</label>
          <input type="number" id="resize-w" value="${this.engine.width}">
        </div>
        <div class="dialog-row">
          <label>New Height (px):</label>
          <input type="number" id="resize-h" value="${this.engine.height}">
        </div>
      `;

      this.createModal('Canvas Frame Dimensions', content, () => {
        const w = parseInt(content.querySelector('#resize-w').value, 10) || this.engine.width;
        const h = parseInt(content.querySelector('#resize-h').value, 10) || this.engine.height;
        this.engine.resizeCanvas(w, h);
        this.updateDocInfo();
        this.drawRulers();
        this.showToast(`Canvas resized to ${w} × ${h} px`, 'info');
      });
    }

    showScaleImageDialog() {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="dialog-row">
          <label>Target Width (px):</label>
          <input type="number" id="scale-w" value="${this.engine.width}">
        </div>
        <div class="dialog-row">
          <label>Target Height (px):</label>
          <input type="number" id="scale-h" value="${this.engine.height}">
        </div>
      `;

      this.createModal('Rescale Entire Image & Layers', content, () => {
        const w = parseInt(content.querySelector('#scale-w').value, 10) || this.engine.width;
        const h = parseInt(content.querySelector('#scale-h').value, 10) || this.engine.height;
        if (this.engine.scaleImage) {
          this.engine.scaleImage(w, h);
        } else {
          this.engine.resizeCanvas(w, h);
        }
        this.updateDocInfo();
        this.drawRulers();
        this.showToast(`Scaled image to ${w} × ${h} px`, 'info');
      });
    }

    showNewLayerDialog() {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="dialog-row">
          <label>Layer Name:</label>
          <input type="text" id="dlg-layer-name" value="New Layer">
        </div>
        <div class="dialog-row">
          <label>Fill Mode:</label>
          <select id="dlg-layer-fill">
            <option value="transparent">Transparent Alpha</option>
            <option value="#ffffff">Opaque White</option>
            <option value="fg">Foreground Color</option>
            <option value="bg">Background Color</option>
          </select>
        </div>
      `;

      this.createModal('Add New Layer', content, () => {
        const name = content.querySelector('#dlg-layer-name').value || 'New Layer';
        let fill = content.querySelector('#dlg-layer-fill').value;
        if (fill === 'fg') fill = this.engine.fgColor;
        if (fill === 'bg') fill = this.engine.bgColor;

        this.engine.addLayer(name, fill);
        this.engine.history.push(`New Layer: ${name}`);
        this.engine.render();
        this.showToast(`Created layer "${name}"`, 'success');
      });
    }

    showExportDialog() {
      const content = document.createElement('div');
      content.innerHTML = `
        <div class="dialog-row">
          <label>Export Format:</label>
          <select id="export-format">
            <option value="png">PNG (Lossless Alpha)</option>
            <option value="jpeg">JPEG (Compressed RGB)</option>
            <option value="webp">WEBP (Modern Web Format)</option>
          </select>
        </div>
        <div class="dialog-row" id="export-quality-row" style="display:none;">
          <label>Encoding Quality (%):</label>
          <input type="range" id="export-quality" min="1" max="100" value="92">
          <span id="export-quality-val" style="width:36px;text-align:right;">92%</span>
        </div>
      `;

      const formatSel = content.querySelector('#export-format');
      const qualRow = content.querySelector('#export-quality-row');
      const qualRange = content.querySelector('#export-quality');
      const qualVal = content.querySelector('#export-quality-val');

      formatSel.addEventListener('change', () => {
        qualRow.style.display = formatSel.value === 'jpeg' || formatSel.value === 'webp' ? 'flex' : 'none';
      });

      qualRange.addEventListener('input', () => {
        qualVal.textContent = `${qualRange.value}%`;
      });

      this.createModal('Export Raster Graphic', content, () => {
        const format = formatSel.value;
        const quality = Number(qualRange.value) / 100;
        const mime = format === 'jpeg' ? 'image/jpeg' : (format === 'webp' ? 'image/webp' : 'image/png');
        const ext = format === 'jpeg' ? 'jpg' : format;
        this.engine.downloadImage(`export.${ext}`, mime, quality);
        this.showToast(`Exported image as ${format.toUpperCase()}`, 'success');
      });
    }

    showShortcutsDialog() {
      const shortcuts = [
        ['Smooth Blend Painter (Brush)', 'P'],
        ['Precision Pixel Writer (Pencil)', 'N'],
        ['Alpha Clearing Tool (Eraser)', 'Shift + E'],
        ['Contiguous Area Flood (Bucket)', 'Shift + B'],
        ['Pixel Color Sampler (Pipette)', 'O'],
        ['Box Area Selector (Rect Select)', 'R'],
        ['Oval Area Selector (Ellipse Select)', 'E'],
        ['Freeform Outline Selector (Lasso)', 'F'],
        ['Layer Position Shifter (Move)', 'M'],
        ['Canvas Frame Trimmer (Crop)', 'Shift + C'],
        ['Typography Rasterizer (Text)', 'T'],
        ['Canvas Magnifier (Zoom)', 'Z'],
        ['Viewport Canvas Scroller (Pan)', 'H or Space (hold)'],
        ['Swap Foreground / Background', 'X'],
        ['Default Palette Black / White', 'D'],
        ['Increase / Decrease Brush Size', '[ and ]'],
        ['Undo Last Action', 'Ctrl + Z'],
        ['Redo Last Action', 'Ctrl + Y / Shift + Ctrl + Z'],
        ['New Canvas Document', 'Ctrl + N'],
        ['Open File', 'Ctrl + O'],
        ['Save Project (.pforge)', 'Ctrl + S'],
        ['Export As Image', 'Shift + Ctrl + E'],
        ['Select All Canvas', 'Ctrl + A'],
        ['Deselect All', 'Ctrl + Shift + A'],
        ['Invert Selection Mask', 'Ctrl + I'],
        ['Zoom In / Out / 100%', '+ , - , 1']
      ];

      const rows = shortcuts.map(([desc, key]) => 
        `<tr><td>${desc}</td><td><span class="key-badge">${key}</span></td></tr>`
      ).join('');

      const content = document.createElement('div');
      content.innerHTML = `
        <div style="max-height:360px;overflow-y:auto;">
          <table class="shortcuts-table">
            <thead>
              <tr><th>Command / Action</th><th>Keyboard Shortcut</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;

      this.createModal('Keyboard Shortcuts Reference', content, null, null, { width: '480px' });
    }

    showAboutDialog() {
      const content = document.createElement('div');
      content.style.textAlign = 'center';
      content.style.padding = '8px 0';
      content.innerHTML = `
        <div style="font-size:36px;margin-bottom:8px;">⚡</div>
        <h2 style="font-size:16px;font-weight:700;margin-bottom:4px;">PixelForge Studio</h2>
        <p style="color:#aaa;margin-bottom:12px;">Modern Digital Image &amp; Raster Graphics Suite</p>
        <p style="font-size:11px;color:#888;line-height:1.6;">
          Professional client-side raster graphics and creative editing suite.<br>
          High-performance multi-layer compositing, blend modes, non-destructive undo/redo stack, 
          marching ants selection masks, and pixel filter suite.<br>
          Native project file format: <strong>.pforge</strong>
        </p>
      `;
      this.createModal('About PixelForge Studio', content, null, null, { width: '380px' });
    }

    // =========================================================================
    // Toast Notifications
    // =========================================================================

    showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.textContent = message;

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.transition = 'opacity 0.3s, transform 0.3s';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }
  }

  // Export UI Controller singleton
  global.PixelForge.UI = new UIController();
  global.PixelForge.currentUI = global.PixelForge.UI;
  global.GIMP.UI = global.PixelForge.UI;
  global.GIMP.currentUI = global.PixelForge.UI;

  // Auto-initialize when window loads
  window.addEventListener('DOMContentLoaded', () => {
    let engine = (global.PixelForge && global.PixelForge.currentEngine) || (global.GIMP && global.GIMP.currentEngine);
    const EngineClass = (global.PixelForge && global.PixelForge.Engine) || (global.GIMP && global.GIMP.Engine);

    if (!engine && EngineClass) {
      engine = new EngineClass();
    }
    if (engine) {
      global.PixelForge.UI.init(engine);
    }
  });

})(typeof window !== 'undefined' ? window : this);
