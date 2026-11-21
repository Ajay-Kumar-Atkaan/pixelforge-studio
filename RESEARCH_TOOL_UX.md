# Research: Modern Raster Graphics Editor Tool UX & Creative Testing Methodologies

## 1. Executive Summary & Defect Root-Cause Analysis

This research document establishes the architectural, interaction design, and verification standards for creative raster graphics editors (specifically Web-GIMP / PixelForge Studio), addressing critical usability feedback from real-world testing.

### 1.1 Root-Cause Analysis of Reported Deficiencies

#### Defect 1: Text Tool Stamps Hardcoded Default Rather Than Interactive Typing
- **Observed Behavior**: Selecting the Typography Rasterizer (`TextTool`) and clicking on the canvas immediately stamps the hardcoded string `"PixelForge Studio"` or `"PixelForge"` directly onto a new layer. No text cursor, input prompt, or interactive editing surface appears on canvas.
- **Root Cause**:
  In `src/tools.js` (`TextTool.onPointerDown`), the tool was implemented as an instant raster stamp:
  ```javascript
  let text = this.options.text || 'PixelForge';
  const layer = engine.addLayer(`Type: ${text.slice(0, 10)}`);
  layer.ctx.fillText(text, coords.x, coords.y);
  ```
  While a textarea existed in the left dock's Tool Options, users do not expect to navigate to an external sidebar, type into a small box, and then click the canvas to "stamp" the text like a rubber ink stamp.
- **Industry Standard (GIMP / Photoshop / Photopea)**:
  When a user selects the Text Tool and clicks the canvas, an interactive on-canvas typing session begins immediately at that point. A floating text input box or overlay editor is spawned at the canvas coordinates, focused with a blinking caret, allowing real-time character typing with live typography styling.

#### Defect 2: Layer Renaming Does Not Work via Double-Click in Layer Dock
- **Observed Behavior**: Double-clicking a layer name in the right-hand layer dock fails to open an editable input or persist a renamed layer.
- **Root Cause**:
  In `src/ui.js` (`updateLayersList`):
  ```javascript
  item.addEventListener('click', () => {
    this.engine.layers.setActiveLayer(i);
    this.updateLayersList(); // <-- DESTRUCTIVE FULL RE-RENDER!
  });
  ```
  A double-click gesture consists of a rapid sequence: `mousedown` $\to$ `mouseup` $\to$ `click` $\to$ `mousedown` $\to$ `mouseup` $\to$ `click` $\to$ `dblclick`.
  When the first click occurred on `item`, `setActiveLayer(i)` was triggered, which executed `this.updateLayersList()`. This wiped `item` and `nameLabel` completely from the DOM and replaced them with brand new DOM elements. Consequently, the second click landed on a newly created element, breaking the native browser double-click gesture pipeline (`dblclick` never fired on the original target).
  Additionally, in `src/layers.js`, `renameLayer(index, newName)` did not push an undo state to the History stack, violating non-destructive editor principles.

---

## 2. Modern Raster Graphics Editor UX Paradigms

```
+-----------------------------------------------------------------------------------------+
|                                    CREATIVE TOOL UX MODEL                               |
+-----------------------------------------------------------------------------------------+
       |                                      |                                    |
       v                                      v                                    v
+-----------------------------+ +-----------------------------+ +-------------------------+
|     WYSIWYG Interactivity   | |     State Safety & Undo     | |     Spatial Coherence   |
| - On-canvas text input      | | - Every action is undoable  | | - Inline layer rename   |
| - Live typography styling   | | - Escape cancels cleanly    | | - Floating HUD controls |
| - Real-time slider feedback | | - No destructive side-effects| | - Zoom/Pan coordination |
+-----------------------------+ +-----------------------------+ +-------------------------+
```

### 2.1 Interactive Typography Tool UX

In leading raster editors (Adobe Photoshop, GIMP 2.10/3.0, Photopea, Figma), text authoring follows strict interaction standards:

#### 1. The Interaction Lifecycle
1. **Activation**: User selects the Text Tool (`T`). The cursor over the canvas becomes an I-beam cursor (`cursor: text`).
2. **Point of Origin**:
   - **Point Text (Standard)**: Single click on the canvas sets the text baseline anchor $(X_c, Y_c)$. An on-canvas floating text editor immediately opens at that location.
   - **Area / Paragraph Text**: Click-and-drag defines a bounding box width/height. Text wraps within the frame.
3. **On-Canvas Typing Overlay**:
   - The editor is rendered as a clean HTML overlay container (e.g. `div.canvas-text-overlay`) positioned directly over the viewport at the calculated screen coordinates:
     $$X_s = (X_c \times \text{zoom}) + \text{panX} + \text{viewportOffsetLeft}$$
     $$Y_s = (Y_c \times \text{zoom}) + \text{panY} + \text{viewportOffsetTop}$$
   - The overlay contains an auto-expanding `textarea` or `contenteditable` container with zero background, subtle dashed border outline (`1px dashed #4a82d0`), and dynamic font size scaled proportionally:
     $$\text{overlayFontSize} = \text{fontSize} \times \text{zoom} \text{ px}$$
   - Focus is automatically requested (`input.focus()`).
4. **Live Typography Controls**:
   - Font Family (sans-serif, serif, monospace, Arial, Times New Roman, Impact, Georgia, Courier New).
   - Font Size (8px to 144px).
   - Font Weight (Regular, Bold) and Style (Normal, Italic).
   - Color (Foreground color swatch / color picker).
   - Any adjustment in the Tool Options bar or floating HUD updates the on-canvas text in real-time.
5. **Commitment Ergonomics**:
   - **Enter** (for single-line point text) or **Ctrl+Enter** (for multi-line text) or **clicking outside (blur)** commits the text.
   - Upon commitment:
     - If text is non-empty: The text is rasterized onto the active or newly created layer at $(X_c, Y_c)$.
     - Layer is named `Type: "<text-preview>"`.
     - Undo snapshot is pushed: `"Add Text: <text>"`.
   - **Escape**: Immediately aborts the text entry session, removes the overlay, and creates **no** layer, leaving the document state pristine.

#### 2. Text Layer Data Model & Persistence
In modern creative apps, text layers should not just be blind rasterized pixels; they maintain metadata on the `Layer` instance:
```javascript
layer.isTextLayer = true;
layer.textData = {
  text: "My Heading",
  fontFamily: "Arial, sans-serif",
  fontSize: 36,
  bold: false,
  italic: false,
  color: "#ff0000",
  x: 120,
  y: 80
};
```
This metadata enables re-editing, raster regeneration on canvas resize, and export to `.wgimp` JSON project files.

---

### 2.2 Layer Management & In-Place Renaming UX

In Photoshop, GIMP, and Photopea, layers represent the fundamental organizational hierarchy. Layer renaming is one of the highest-frequency actions.

#### 1. Gesture Separation & Event Delegation
To resolve the double-click destruction defect:
- **Click (Single)**: Selects/activates the layer.
  - **Optimization**: If the clicked layer is *already* the active layer (`this.engine.layers.activeLayerIndex === i`), do **not** trigger a full DOM rebuild of `#layer-list`. Simply ensure `.active` class is applied.
- **Double-Click**: Triggers in-place renaming.
  - The `dblclick` event listener is attached to `.layer-name` or `.layer-item`.
  - When triggered, it stops event propagation (`e.stopPropagation()`).
  - The `.layer-name` span is replaced by an `<input type="text" class="layer-name-input">`.

#### 2. Input Lifecycle & Focus Trapping
```
[User Double-Clicks .layer-name]
               |
               v
[Create input.layer-name-input] ---> [Set initial value = layer.name]
               |
               v
[Replace span with input in DOM]
               |
               v
[input.focus() + input.select()] ---> (Full text highlighted for instant overwrite)
               |
    +----------+----------+
    |                     |
    v (User presses Enter v (User presses Escape)
    or clicks outside/blur)
    |                     |
[Sanitize value]          [Discard changes]
[layer.name = newName]    [Restore original name]
[history.push('Rename')]  |
    |                     |
    +----------+----------+
               |
               v
    [Re-render layer item]
```

#### 3. Keyboard & Blur Semantics
- **Enter Key**: Commits the new name, calls `engine.layers.renameLayer(i, newName)`, pushes history step `"Rename Layer: <old> -> <new>"`, and exits edit mode.
- **Escape Key**: Cancels editing, restores original name without pushing history.
- **Blur (Focus Loss)**: Commits if valid non-empty string, otherwise reverts.
- **Empty String Fallback**: If user clears input and presses Enter, fallback to the previous name or `"Layer " + (i + 1)`.

---

## 3. Real-World Usability Expectations for Raster Tools

When creative professionals and everyday users interact with a raster image editor, their mental models demand predictable, responsive, and forgiving tool behaviors:

| Tool Category | Real-World User Expectation | Common Pitfall / Anti-Pattern | Correct Design Specification |
| :--- | :--- | :--- | :--- |
| **Typography (`T`)** | Clicks canvas, types custom words immediately, sees text live. | Clicking stamps hardcoded default text without allowing input. | Inline on-canvas editable overlay positioned at pointer coordinates. |
| **Layer Renaming** | Double-clicks layer name in panel to edit label in place. | Single click re-renders list, destroying DOM and eating double-click. | Event separation; inplace input replacement with `select()`. |
| **Brush / Pencil (`P`, `N`)** | Smooth, continuous strokes matching pointer velocity without gaps. | Dotted/dashed broken lines on fast mouse sweeps. | Sub-pixel stroke interpolation using Bresenham/linear stepping. |
| **Color Picker (`O`)** | Instant feedback in FG swatch as user hovers or clicks canvas. | Swatch updates only after deselecting tool. | Real-time sampling from composite buffer on pointer down/drag. |
| **Crop Tool (`Shift+C`)** | Draggable frame with rule-of-thirds grid, commits on Enter, cancels on Esc. | Instantly trims canvas on first click. | Two-phase crop: interactive preview rectangle, commit on Enter/double-click. |
| **Undo / Redo (`Ctrl+Z`)** | Every single action (strokes, transforms, renames, filters) is reversible. | State changes bypass history or corrupt layer stack order. | Command pattern / Snapshot stack with explicit naming and state cloning. |

---

## 4. Testing Methodologies for Creative & Canvas-Based Applications

Standard software testing methodologies (such as simple DOM unit tests or mock assertions) consistently fail to catch usability defects in creative canvas applications. Below is the comprehensive testing framework designed to guarantee real-world usability.

```
+-----------------------------------------------------------------------------------------+
|                         CREATIVE APP TESTING TAXONOMY                                   |
+-----------------------------------------------------------------------------------------+
  1. Synthetic Unit Tests       --> Mathematical correctness (LUTs, convolution kernels)
  2. DOM Lifecycle Tests         --> Event propagation, gesture separation, focus states
  3. Canvas-to-Screen Mapping   --> Coordinate transformation accuracy under zoom & pan
  4. User Workflow Simulation    --> End-to-end human action scripts (Type, Drag, Commit)
  5. Visual Regression Tests     --> Pixel delta verification on composite image buffer
```

### 4.1 Why Traditional Testing Fails for Creative Tools
1. **Mock Blindness**: Mocking `HTMLCanvasElement.getContext('2d')` with stub functions confirms that `ctx.fillText` was called, but fails to test whether the user had a way to input the string!
2. **Missing DOM Event Cascades**: Unit tests often dispatch an isolated `'dblclick'` event directly on an element without dispatching the preceding `'mousedown'`, `'mouseup'`, and `'click'` events that trigger side-effect re-renders in real browsers.
3. **Disconnected Tool States**: Testing a tool's internal methods directly (`tool.onPointerDown(...)`) bypasses the UI event listeners, toolbar synchronization, and active tool switches.

### 4.2 Usability & End-to-End Testing Criteria

To ensure complete coverage, all creative tools must pass four tiers of automated verification:

#### Tier 1: Interactive Typography User Journey Test (`test_usability_e2e.html`)
- **Step 1**: Activate Text Tool (`T`).
- **Step 2**: Dispatch realistic pointer event sequence at canvas coordinates $(100, 150)$.
- **Step 3**: Verify that **no** layer is immediately created with dummy text.
- **Step 4**: Assert presence of interactive on-canvas text input overlay (`.canvas-text-overlay` or `#canvas-text-editor`).
- **Step 5**: Verify overlay is positioned at correct screen coordinates matching $(100, 150)$ under current canvas zoom and pan.
- **Step 6**: Simulate keyboard typing: dispatch `keydown`, `input` events with custom text (e.g. `"Design Systems 2026"`).
- **Step 7**: Change font size to `42px` and font family to `'Arial'` in Tool Options; assert live overlay style reflects new font size and family.
- **Step 8**: Press `Enter` or click commit button.
- **Step 9**: Assert:
  - Overlay is cleanly removed from DOM.
  - A new layer is added to `LayerManager` named `Type: Design Systems 2026`.
  - Layer canvas contains rasterized text pixels at $(100, 150)$.
  - Undo stack has entry `"Add Text: Design Systems 2026"`.
- **Step 10 (Escape Test)**: Click canvas again, type `"To be cancelled"`, press `Escape`. Assert overlay is removed and **no** layer was added.

#### Tier 2: In-Place Layer Renaming Test
- **Step 1**: Initialize document with 2 layers ("Background", "Layer 1").
- **Step 2**: Locate `.layer-item` for Layer 1.
- **Step 3**: Dispatch realistic full click sequence: `mousedown` $\to$ `mouseup` $\to$ `click` $\to$ `mousedown` $\to$ `mouseup` $\to$ `click` $\to$ `dblclick` on `.layer-name`.
- **Step 4**: Assert `.layer-name` is replaced by `input.layer-name-input`.
- **Step 5**: Assert `input.value === "Layer 1"` and `document.activeElement === input`.
- **Step 6**: Set `input.value = "Hero Artwork"` and dispatch `input` event.
- **Step 7**: Dispatch `keydown` with `key: "Enter"`.
- **Step 8**: Assert:
  - `engine.layers.layers[1].name === "Hero Artwork"`.
  - DOM displays updated `.layer-name` with text `"Hero Artwork"`.
  - History stack contains snapshot `"Rename Layer: Layer 1 -> Hero Artwork"`.
- **Step 9 (Escape Test)**: Double-click again, type `"Temporary"`, press `Escape`. Assert `engine.layers.layers[1].name` remains `"Hero Artwork"`.

#### Tier 3: Undo/Redo Fidelity Across Usability Operations
- **Step 1**: Perform layer rename (`"Layer 1"` $\to$ `"Hero Artwork"`).
- **Step 2**: Perform interactive text creation (`"Welcome"`).
- **Step 3**: Trigger `engine.history.undo()`.
  - Assert text layer is removed.
  - Assert layer name remains `"Hero Artwork"`.
- **Step 4**: Trigger `engine.history.undo()`.
  - Assert layer name reverts to `"Layer 1"`.
- **Step 5**: Trigger `engine.history.redo()` twice.
  - Assert layer name is restored to `"Hero Artwork"` and text layer `"Welcome"` is restored.

#### Tier 4: Cross-Tool State Machine Invariant Test
- Verify that opening a text entry overlay and then selecting another tool (e.g. Brush or Move) commits or cleanly closes the text overlay without leaving orphaned DOM nodes or broken cursor states.

---

## 5. Architectural Blueprints for Development Swarm

### 5.1 Blueprint for `@ui-dev`

#### 1. Interactive On-Canvas Typography Editor in `src/tools.js` / `src/ui.js`
Create a dedicated `OnCanvasTextEditor` controller:
```javascript
class OnCanvasTextEditor {
  constructor(engine, ui) {
    this.engine = engine;
    this.ui = ui;
    this.active = false;
    this.overlay = null;
    this.input = null;
    this.coords = { x: 0, y: 0 };
  }

  open(coords, initialOptions) {
    this.close(false); // Close any existing session
    this.coords = coords;
    this.options = { ...initialOptions };

    // Compute screen coordinates from canvas coordinates
    const screenPos = this.engine.canvasToScreen(coords.x, coords.y);
    const viewportRect = this.ui.canvasViewport.getBoundingClientRect();

    // Create floating overlay container
    this.overlay = document.createElement('div');
    this.overlay.className = 'canvas-text-overlay';
    this.overlay.style.position = 'absolute';
    this.overlay.style.left = `${screenPos.x}px`;
    this.overlay.style.top = `${screenPos.y}px`;
    this.overlay.style.zIndex = '50';

    // Create interactive input
    this.input = document.createElement('textarea');
    this.input.className = 'canvas-text-input';
    this.input.placeholder = 'Type text here... (Enter to commit, Esc to cancel)';
    this.input.value = '';
    this.updateStyle();

    // Event handling
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
    });

    this.input.addEventListener('blur', (e) => {
      // Small timeout to allow button clicks in tool options
      setTimeout(() => {
        if (this.active) this.commit();
      }, 150);
    });

    this.overlay.appendChild(this.input);
    this.ui.canvasViewport.appendChild(this.overlay);

    this.active = true;
    this.input.focus();
  }

  updateStyle() {
    if (!this.input) return;
    const zoom = this.engine.zoom || 1;
    const scaledSize = Math.max(12, Math.round(this.options.fontSize * zoom));
    this.input.style.fontFamily = this.options.fontFamily || 'sans-serif';
    this.input.style.fontSize = `${scaledSize}px`;
    this.input.style.fontWeight = this.options.bold ? 'bold' : 'normal';
    this.input.style.fontStyle = this.options.italic ? 'italic' : 'normal';
    this.input.style.color = this.engine.fgColor || '#ffffff';
  }

  commit() {
    if (!this.active) return;
    const text = this.input.value.trim();
    if (text) {
      this.engine.addTextLayer(text, this.coords.x, this.coords.y, this.options);
      this.ui.showToast(`Added text layer "${text.slice(0, 15)}"`, 'info');
    }
    this.close(true);
  }

  cancel() {
    if (!this.active) return;
    this.close(false);
  }

  close() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.input = null;
    this.active = false;
  }
}
```

#### 2. Layer Dock In-Place Renaming Overhaul in `src/ui.js`
Refactor `updateLayersList`:
```javascript
// Inside updateLayersList():
nameLabel.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  e.preventDefault();

  const currentName = layer.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'layer-name-input';
  input.value = currentName;

  // Replace label with input without full list rebuild
  nameLabel.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      this.engine.renameLayer(i, newName);
    } else {
      this.updateLayersList();
    }
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    this.updateLayersList();
  };

  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') {
      ke.preventDefault();
      commit();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      cancel();
    }
  });

  input.addEventListener('blur', commit);
});

// Avoid destroying the DOM if layer is already active
item.addEventListener('click', (e) => {
  if (e.target.closest('.layer-name-input')) return;
  if (this.engine.layers.activeLayerIndex !== i) {
    this.engine.layers.setActiveLayer(i);
    this.updateLayersList();
  }
});
```

---

### 5.2 Blueprint for `@core-dev`

#### 1. LayerManager & Engine API Enhancements
In `src/layers.js` and `src/engine.js`:
- Add `renameLayer(index, newName)` with automatic History integration:
  ```javascript
  renameLayer(index, newName) {
    if (index >= 0 && index < this.layers.length && newName) {
      const oldName = this.layers[index].name;
      const cleanName = String(newName).trim();
      if (cleanName && cleanName !== oldName) {
        this.layers[index].name = cleanName;
        this.emit('changed');
        return { oldName, newName: cleanName };
      }
    }
    return null;
  }
  ```
- In `src/engine.js`:
  ```javascript
  renameLayer(index, newName) {
    const result = this.layers.renameLayer(index, newName);
    if (result) {
      this.history.push(`Rename Layer: "${result.oldName}" -> "${result.newName}"`);
      this.render();
      return true;
    }
    return false;
  }

  addTextLayer(text, x, y, options = {}) {
    const layer = this.addLayer(`Type: ${text.slice(0, 15)}`);
    layer.isTextLayer = true;
    layer.textData = {
      text,
      fontFamily: options.fontFamily || 'sans-serif',
      fontSize: options.fontSize || 28,
      bold: !!options.bold,
      italic: !!options.italic,
      color: this.fgColor || '#ffffff',
      x,
      y
    };

    layer.ctx.save();
    const style = `${layer.textData.italic ? 'italic ' : ''}${layer.textData.bold ? 'bold ' : ''}${layer.textData.fontSize}px ${layer.textData.fontFamily}`;
    layer.ctx.font = style;
    layer.ctx.fillStyle = layer.textData.color;
    layer.ctx.textBaseline = 'top';
    layer.ctx.fillText(text, x, y);
    layer.ctx.restore();

    this.history.push(`Add Text: "${text.slice(0, 15)}"`);
    this.render();
    return layer;
  }
  ```

---

### 5.3 Blueprint for `@verifier`

#### Test Automation Architecture:
1. Create `test_usability_e2e.html`: Standalone browser test harness loading `engine.js`, `layers.js`, `filters.js`, `tools.js`, `ui.js`, and styling.
2. Create `run_usability_test.py`: Headless browser / runner script executing:
   - Interactive Text Entry (click, overlay spawn, typing, commit, canvas pixel verification, escape cancellation).
   - In-place Layer Renaming (double-click, input spawn, value change, Enter commit, Escape cancellation).
   - Undo/Redo sequence validation.
   - Re-running `verify.py`, `run_cross_test.py`, and `run_live_canvas_e2e.py`.
3. Require **100% test pass rate** with zero console errors before final sign-off.

---

*Authored by @researcher for the Web-GIMP / PixelForge Studio development swarm.*
