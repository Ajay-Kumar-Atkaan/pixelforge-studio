# Web-GIMP: Complete Technical Reference, Architecture & Feature Roadmap

## 1. Executive Summary & Vision

**Web-GIMP** is a browser-based, high-fidelity recreation of the GNU Image Manipulation Program (GIMP). It delivers a professional-grade raster graphics editing experience directly in modern web browsers without server-side processing dependencies.

### Design Principles & Visual Identity
- **Wilber Aesthetic**: Inspired by GIMP 2.10 and GIMP 3.0 dark theme (`#282828`, `#383838`, `#424242` charcoal surfaces, subtle 1px border dividers `#1f1f1f`, `#505050` active accents).
- **High Information Density**: Compact toolbars, small-footprint iconography, docked side panels, integrated ruler rails, and responsive status bar.
- **Client-Side Non-Destructive Compositing**: Multi-canvas layer stack evaluated client-side via standard HTML5 Canvas 2D and typed array pixel manipulation (`ImageData` / `Uint32Array`).
- **Immediate Feedback Loop**: Interactive live preview on color adjustments and spatial filters, interactive transform bounding boxes, and real-time marching ants selection marquee.

---

## 2. Core Architecture & Mental Model

```
+-----------------------------------------------------------------------------------+
|                                  GimpApp (Global State)                           |
+-----------------------------------------------------------------------------------+
       |                        |                           |                 |
       v                        v                           v                 v
+--------------+      +-------------------+      +--------------------+  +------------+
|  LayerStack  |      |   SelectionModel  |      |  UndoRedoHistory   |  | ToolEngine |
| - layers[]   |      | - maskCanvas (1-bit|      | - snapshots[]      |  | - active   |
| - activeLayer|      |   or 8-bit alpha) |      | - index            |  | - options  |
| - blendModes |      | - marchingAntsOffs|      | - maxDepth (30)    |  +------------+
| - opacities  |      | - boundingBox     |      +--------------------+
+--------------+      +-------------------+
       |                        |
       +------------+-----------+
                    |
                    v
       +----------------------------+
       |   Composite / Render Loop  |
       | - Composites layers into   |
       |   working buffer           |
       | - Applies view Zoom & Pan  |
       | - Draws rulers & guides    |
       | - Renders Marching Ants    |
       | - Outputs to Viewport DOM  |
       +----------------------------+
```

### 2.1 Coordinate Systems
Web-GIMP operates across three distinct coordinate spaces:
1. **Document / Canvas Coordinates $(X_c, Y_c)$**: Integer pixel coordinates within the image bounded by $[0, \text{width}]$ and $[0, \text{height}]$. All drawing, raster filters, and layer transformations execute in this space.
2. **Viewport Coordinates $(X_v, Y_v)$**: Scaled and translated coordinates inside the canvas viewport container:
   $$X_v = (X_c \times \text{zoom}) + \text{panX}$$
   $$Y_v = (Y_c \times \text{zoom}) + \text{panY}$$
3. **Screen / Client Coordinates $(X_s, Y_s)$**: Mouse/pointer event coordinates relative to the browser window.
   Converting pointer event to canvas coordinates:
   $$X_c = \lfloor \frac{X_s - \text{viewportBoundingBox.left} - \text{panX}}{\text{zoom}} \rfloor$$
   $$Y_c = \lfloor \frac{Y_s - \text{viewportBoundingBox.top} - \text{panY}}{\text{zoom}} \rfloor$$

### 2.2 Layer Engine (`layers.js`)
Each layer is an isolated object containing:
- `id`: Unique string (UUID or timestamp-based).
- `name`: Human-readable label (e.g., "Background", "Layer 1").
- `width`, `height`: Layer dimensions (defaults to image size).
- `x`, `y`: Offset relative to canvas origin (supports layers positioned outside boundaries).
- `canvas`: Dedicated offscreen `HTMLCanvasElement` holding layer pixel data.
- `ctx`: 2D rendering context with `{ willReadFrequently: true }`.
- `visible`: Boolean flag (toggled via eye icon).
- `opacity`: Normalized scalar $[0.0, 1.0]$.
- `blendMode`: Standard and advanced blend mode string.
- `locked`: Boolean preventing modifications.

Compositing Pipeline:
1. Initialize clear composite canvas of image size: `ctx.clearRect(0, 0, width, height)`.
2. Iterate through `layers` array from index 0 (bottom-most) to index $N-1$ (top-most).
3. If `!layer.visible` or `layer.opacity <= 0`, skip.
4. Set composite context `globalAlpha = layer.opacity`.
5. Set `globalCompositeOperation = mapBlendMode(layer.blendMode)`.
6. Call `compositeCtx.drawImage(layer.canvas, layer.x, layer.y)`.
7. Reset `globalAlpha = 1.0` and `globalCompositeOperation = 'source-over'`.

### 2.3 Selection Engine & Marching Ants
Selections constrain all drawing, filling, deleting, and filtering operations.
- **Mask Representation**: Dedicated 8-bit alpha mask canvas (`maskCanvas`) of the same size as the document. Pixel values are $0$ (unselected) through $255$ (fully selected).
- **Selection State**:
  - `hasSelection`: Fast boolean flag. If `false`, operations apply to the entire active layer.
  - `selectionBounds`: Cached $\{x, y, width, height\}$ bounding box of selected pixels to optimize filter scans.
- **Marching Ants Rendering**:
  - Rendered on a top-level overlay canvas atop the layer viewport.
  - Uses `ctx.setLineDash([4, 4])` and animated `ctx.lineDashOffset = (Date.now() / 80) % 8`.
  - Draw border path in black with white dash offset or dual-stroke for contrast on both black and white pixels:
    - Stroke 1: Solid black line.
    - Stroke 2: Dashed white line with animated offset.

### 2.4 History & Undo/Redo Engine
- Snapshot-based command pattern tracking active document state:
  ```typescript
  interface HistoryStep {
    id: string;
    description: string; // e.g. "Paintbrush", "New Layer", "Gaussian Blur"
    timestamp: number;
    layersData: Array<{
      id: string;
      name: string;
      visible: boolean;
      locked: boolean;
      opacity: number;
      blendMode: string;
      x: number;
      y: number;
      imageData: ImageData; // or serialized bitmap
    }>;
    activeLayerId: string;
    selectionMaskData?: ImageData | null;
  }
  ```
- Circular or capped stack with configurable depth (e.g., 30 steps) to balance memory usage against deep undo histories.

---

## 3. GIMP Tools Taxonomy & Specifications

| Tool Name | Hotkey | Category | Icon Metaphor | Key Options | Canvas Interaction Logic |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Rectangle Select** | `R` | Selection | Dashed Rectangle | Feather radius, Expand from center, Fixed aspect ratio | Mouse drag creates box; Shift adds, Alt/Ctrl subtracts, Shift+Ctrl intersects |
| **Ellipse Select** | `E` | Selection | Dashed Ellipse | Feather radius, Fixed ratio, Antialiasing | Mouse drag creates bounding box; draws ellipse in selection mask |
| **Free Select (Lasso)** | `F` | Selection | Lasso rope loop | Antialiasing, Feathering | Click & drag freehand polygon or click vertices to close polygon loop |
| **Fuzzy Select (Magic Wand)** | `U` | Selection | Wand with sparkles | Threshold (0-255), Sample Merged, Select Transparent | Click pixel -> Breadth-First Flood Fill on selection mask based on color distance |
| **Select by Color** | `Shift+O` | Selection | Hand pointing at color swatch | Threshold, Sample Merged | Click pixel -> Scans all pixels matching target color within Euclidean threshold |
| **Move Tool** | `M` | Transform | 4-directional cross arrows | Move Active Layer / Move Selection / Move Path | Drag moves layer $(X, Y)$ offset or translates selection mask boundary |
| **Crop Tool** | `Shift+C` | Transform | Intersecting crop angles | Delete cropped pixels, Aspect ratio lock | Drag rectangular crop window; handles to adjust; Enter or double-click to commit |
| **Rotate Tool** | `Shift+R` | Transform | Circular arrow over square | Angle (degrees), Center pivot $(X_0, Y_0)$ | Drag rotates layer around pivot; live wireframe box; commits via bilinear resample |
| **Scale Tool** | `Shift+S` | Transform | Small square expanding to large | Width, Height, Keep Aspect Ratio | Drag 8-handle box; resamples layer contents via smooth canvas scaling |
| **Flip Tool** | `Shift+F` | Transform | Two mirrored triangles | Direction: Horizontal / Vertical | Click layer to mirror horizontally or vertically (`ctx.scale(-1, 1)` or `(1, -1)`) |
| **Paintbrush** | `P` | Paint | Artist bristle paintbrush | Size (1-500px), Hardness (0-100%), Opacity (1-100%), Spacing | Pointer down/move stamps circular brush tip with radial hardness gradient along interpolated path |
| **Pencil** | `N` | Paint | Sharp graphite pencil | Size (1-500px), Opacity | Hard-edge pixel brush (no antialiasing/feathering) using Bresenham lines |
| **Airbrush** | `A` | Paint | Pneumatic spray airbrush | Rate / Flow, Pressure, Size | Continuous timer-based paint buildup at current pointer coordinates |
| **Eraser** | `Shift+E` | Paint | Rectangular pencil eraser | Size, Hardness, Opacity, Anti-erase | Clears pixels to alpha 0 (`ctx.globalCompositeOperation = 'destination-out'`) |
| **Bucket Fill** | `Shift+B` | Paint | Tilted paint bucket pouring | Fill type: FG / BG / Pattern, Threshold, Fill whole selection | Flood-fill contiguous pixels matching clicked color or fills active selection |
| **Gradient Tool** | `G` | Paint | Gradient spectrum bar | Shape: Linear / Radial; FG to BG, FG to Transparent | Drag line $(x_1, y_1) \to (x_2, y_2)$ creates linear/radial canvas gradient |
| **Clone Tool** | `C` | Paint | Rubber ink stamp | Source point, Sample merged, Alignment | `Ctrl+Click` sets source anchor; dragging copies pixel offset from anchor to destination |
| **Text Tool** | `T` | Vector/Text | Capital letter 'A' | Font family, Font size, Fill Color, Bold/Italic, Alignment | Click canvas creates editable text layer; renders via canvas `fillText` |
| **Color Picker (Eyedropper)** | `O` | Utility | Medical glass pipette | Sample Average radius (1x1, 3x3), Pick FG or BG | Click canvas reads pixel RGB from composite; updates active palette swatch |
| **Zoom Tool** | `Z` | Utility | Magnifying glass (+/-) | Zoom in, Zoom out (hold Ctrl), Zoom 100%, Fit window | Click zooms in by 1.25x centered on click; Ctrl+click zooms out by 0.8x |
| **Measure Tool** | `Shift+U`| Utility | Compass / Ruler caliper | Units (px), Angle readout | Drag line calculates Euclidean distance $\sqrt{\Delta x^2 + \Delta y^2}$ and angle in degrees |

### 3.1 Brush Engine & Stroke Interpolation Algorithm
To prevent dashed/dotted artifacts when drawing fast strokes, all stroke-based tools (Paintbrush, Pencil, Eraser) must interpolate points between consecutive pointer events:
```javascript
function drawInterpolatedStroke(p1, p2, brushSize, spacing, stampFn) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distance = Math.hypot(dx, dy);
  const stepDistance = Math.max(1, brushSize * (spacing / 100));
  const steps = Math.ceil(distance / stepDistance);

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = p1.x + dx * t;
    const y = p1.y + dy * t;
    stampFn(x, y);
  }
}
```

### 3.2 Flood Fill (Bucket & Magic Wand) 32-Bit Scanline / Queue Algorithm
Use a non-recursive, stack-based flood fill reading a direct `Uint32Array` view of `ImageData.data.buffer` for maximum performance ($60\text{ fps}$ on multi-megapixel canvases):
- Color distance Euclidean formula:
  $$\Delta E = \sqrt{(R_1 - R_2)^2 + (G_1 - G_2)^2 + (B_1 - B_2)^2} \le \text{Threshold}$$
- If filling selection mask: write $255$ into mask array.
- If filling canvas: write target 32-bit packed RGBA color (`0xAABBGGRR` in little-endian).

---

## 4. Blend Modes Mathematical Specifications

Compositing two pixel color vectors: Source $S$ (top/incoming layer) and Destination $D$ (bottom/backdrop layer), with normalized channels $s, d \in [0.0, 1.0]$. Output color $f(s, d) \in [0.0, 1.0]$.

| Blend Mode | Group | Formula $f(s, d)$ | Canvas 2D Native Support (`globalCompositeOperation`) |
| :--- | :--- | :--- | :--- |
| **Normal** | Standard | $s$ | `'source-over'` |
| **Multiply** | Darken | $s \times d$ | `'multiply'` |
| **Darken** | Darken | $\min(s, d)$ | `'darken'` |
| **Color Burn** | Darken | $\begin{cases} 0 & s = 0 \\ 1 - \min(1, \frac{1-d}{s}) & s > 0 \end{cases}$ | `'color-burn'` |
| **Screen** | Lighten | $1 - (1 - s)(1 - d) = s + d - s \times d$ | `'screen'` |
| **Lighten** | Lighten | $\max(s, d)$ | `'lighten'` |
| **Color Dodge**| Lighten | $\begin{cases} 1 & s = 1 \\ \min(1, \frac{d}{1-s}) & s < 1 \end{cases}$ | `'color-dodge'` |
| **Overlay** | Contrast | $\begin{cases} 2sd & d < 0.5 \\ 1 - 2(1-s)(1-d) & d \ge 0.5 \end{cases}$ | `'overlay'` |
| **Soft Light** | Contrast | $\begin{cases} d - (1-2s)d(1-d) & s \le 0.5 \\ d + (2s-1)(\sqrt{d}-d) & s > 0.5 \end{cases}$ | `'soft-light'` |
| **Hard Light** | Contrast | $\begin{cases} 2sd & s \le 0.5 \\ 1 - 2(1-s)(1-d) & s > 0.5 \end{cases}$ | `'hard-light'` |
| **Difference** | Inversion | $|s - d|$ | `'difference'` |
| **Exclusion** | Inversion | $s + d - 2sd$ | `'exclusion'` |
| **Hue** | Component | $\text{SetLum}(\text{SetSat}(S, \text{Sat}(D)), \text{Lum}(D))$ | `'hue'` |
| **Saturation** | Component | $\text{SetLum}(\text{SetSat}(D, \text{Sat}(S)), \text{Lum}(D))$ | `'saturation'` |
| **Color** | Component | $\text{SetLum}(S, \text{Lum}(D))$ | `'color'` |
| **Luminosity** | Component | $\text{SetLum}(D, \text{Lum}(S))$ | `'luminosity'` |

---

## 5. Pixel Filters & Color Adjustments

All filters are executed directly on the active layer's `ImageData`, constrained by the `SelectionModel` (if active).

### 5.1 Color Adjustments

#### 1. Brightness & Contrast
- Inputs: Brightness $B \in [-100, 100]$, Contrast $C \in [-100, 100]$.
- Factor: $F = \frac{259(C + 255)}{255(259 - C)}$.
- Formula for each channel $v \in \{R, G, B\}$:
  $$v' = \text{clamp}(F \times (v - 128) + 128 + \frac{B \times 255}{100}, 0, 255)$$

#### 2. Exposure
- Inputs: Exposure value $EV \in [-3.0, +3.0]$.
- Formula:
  $$v' = \text{clamp}(v \times 2^{EV}, 0, 255)$$

#### 3. Hue / Saturation / Lightness (HSL)
- Convert $(R, G, B)$ to $(H, S, L)$ space where $H \in [0, 360)$, $S \in [0, 1]$, $L \in [0, 1]$.
- Shift:
  $$H' = (H + \Delta H + 360) \pmod{360}$$
  $$S' = \text{clamp}(S \times (1 + \frac{\Delta S}{100}), 0, 1)$$
  $$L' = \text{clamp}(L + \frac{\Delta L}{100}, 0, 1)$$
- Convert back $(H', S', L') \to (R', G', B')$.

#### 4. Levels Adjustment
- Inputs:
  - Input Black $In_{min} \in [0, 253]$
  - Input White $In_{max} \in [In_{min}+1, 255]$
  - Gamma $\gamma \in [0.1, 10.0]$
  - Output Black $Out_{min} \in [0, 255]$
  - Output White $Out_{max} \in [0, 255]$
- Formula:
  $$v_{\text{norm}} = \text{clamp}\left(\frac{v - In_{min}}{In_{max} - In_{min}}, 0, 1\right)$$
  $$v_{\text{gamma}} = v_{\text{norm}}^{\frac{1}{\gamma}}$$
  $$v' = \text{round}(v_{\text{gamma}} \times (Out_{max} - Out_{min}) + Out_{min})$$
- Lookup Table (LUT) optimization: Precompute 256-element array for $O(1)$ per-pixel evaluation.

#### 5. Curves
- Piecewise cubic Hermite / Catmull-Rom spline passing through user control points $(x_0, y_0), (x_1, y_1), \dots, (x_k, y_k)$.
- Evaluated as a precomputed 256-byte LUT mapping input luminance $x \in [0, 255]$ to output luminance $y \in [0, 255]$.

#### 6. Invert
- $$v' = 255 - v$$

#### 7. Desaturate / Grayscale
- **Luminance (Rec. 709 / sRGB recommended)**:
  $$Y = \text{round}(0.2126R + 0.7152G + 0.0722B)$$
- **Lightness**:
  $$Y = \text{round}\left(\frac{\max(R, G, B) + \min(R, G, B)}{2}\right)$$
- **Average**:
  $$Y = \text{round}\left(\frac{R + G + B}{3}\right)$$
- Set $R' = G' = B' = Y$.

#### 8. Sepia Tone
- Affine color matrix transformation:
  $$R' = \min(255, 0.393R + 0.769G + 0.189B)$$
  $$G' = \min(255, 0.349R + 0.686G + 0.168B)$$
  $$B' = \min(255, 0.272R + 0.534G + 0.131B)$$

---

### 5.2 Spatial & Convolution Filters

#### 1. Gaussian Blur
- Separable 1D convolution decomposed into horizontal and vertical passes:
  $$G(x) = \frac{1}{\sqrt{2\pi}\sigma} e^{-\frac{x^2}{2\sigma^2}}$$
- Radius $r = \lceil 3\sigma \rceil$.
- Performance: $2 \times (2r + 1)$ operations per pixel instead of $(2r + 1)^2$.

#### 2. Sharpen (Unsharp Mask)
- 3x3 Convolution matrix:
  $$\begin{bmatrix} 0 & -1 & 0 \\ -1 & 5 & -1 \\ 0 & -1 & 0 \end{bmatrix}$$
- Configurable amount: $I_{\text{sharp}} = \text{clamp}(I + \alpha(I - I_{\text{blur}}), 0, 255)$.

#### 3. Edge Detection (Sobel)
- Horizontal and vertical gradient kernels:
  $$K_x = \begin{bmatrix} -1 & 0 & +1 \\ -2 & 0 & +2 \\ -1 & 0 & +1 \end{bmatrix}, \quad K_y = \begin{bmatrix} -1 & -2 & -1 \\ 0 & 0 & 0 \\ +1 & +2 & +1 \end{bmatrix}$$
- Gradient magnitude:
  $$G = \text{clamp}\left(\sqrt{G_x^2 + G_y^2}, 0, 255\right)$$

#### 4. Pixelize (Mosaic)
- Inputs: Block size $S \ge 2$.
- Subdivide canvas into $S \times S$ blocks.
- Sample average or central color within the block, then paint the entire $S \times S$ rectangle with that solid color.

#### 5. Noise (RGB / Uniform)
- Inputs: Amount $A \in [0, 100]$.
- Formula:
  $$\delta = (\text{Math.random}() - 0.5) \times 2 \times \frac{A \times 255}{100}$$
  $$v' = \text{clamp}(v + \delta, 0, 255)$$

---

## 6. GIMP Dialog Docks & UI Layout Architecture

The user interface reproduces GIMP's signature single-window desktop workspace:

```
+---------------------------------------------------------------------------------------------------------+
| Menu Bar: [File] [Edit] [Select] [View] [Image] [Layer] [Colors] [Tools] [Filters] [Help]               |
+-------------------+-----------------------------------------------------------------+-------------------+
| LEFT DOCK         | CENTER VIEWPORT (Canvas Workspace)                              | RIGHT DOCK        |
| +---------------+ | +-[Horizontal Ruler]------------------------------------------+ | +---------------+ |
| | Toolbox       | | |                                                            | | | Tabs:           | |
| | [R][E][F][U]  | | |                                                            | | | [Layers]        | |
| | [M][C][S][F]  | | [                                                            | | | [Channels]      | |
| | [P][N][E][B]  | | V                                                            | | | [Paths]         | |
| | [G][C][T][O]  | | R                                                            | | +---------------+ |
| | [Z][U]        | | u     Centered Document Canvas:                              | | | Blend: [Normal] | |
| |               | | l     [ Checkerboard Alpha Background ]                      | | | Opacity: [ 100%]| |
| | Active Colors | | e     [ Active Layers Composited      ]                      | | |---------------| |
| | [FG] / [BG]   | | r     [ Marching Ants Selection Box   ]                      | | | [X] Layer 2     | |
| | [X Swap] [D]  | | ]                                                            | | | [X] Background  | |
| +---------------+ | |                                                            | | +---------------+ |
| | Tool Options  | | |                                                            | | | [New][Up][Down] | |
| | Size:   [ 20] | | |                                                            | | | [Dup][Merge][Del| |
| | Opacity:[100] | | +------------------------------------------------------------+ | +---------------+ |
| | Hardness:[80] | |                                                                 | | Tabs:           | |
| | Threshold:[15]| | Scrollbars / Pan Control                                        | | [Undo History]  | |
| +---------------+ |                                                                 | | [Brushes]       | |
+-------------------+-----------------------------------------------------------------+-------------------+
| Status Bar: (X: 450, Y: 280) px | 100% Zoom [ - | + ] | Layer: "Background" (1920x1080 RGBA)            |
+---------------------------------------------------------------------------------------------------------+
```

### 6.1 Menu Bar Tree Structure

- **File**
  - New... (`Ctrl+N`): Opens dialog (Width, Height, Background Color: White / Transparent / FG / BG).
  - Open... (`Ctrl+O`): File input picker loading PNG, JPEG, WEBP, GIF, SVG.
  - Open as Layers...: Imports image directly as a new layer inside existing project.
  - Save Project (`Ctrl+S`): Downloads `.wgimp` project JSON bundle.
  - Export As... (`Shift+Ctrl+E`): Dialog with format selector (PNG, JPEG with quality slider, WEBP).
  - Close: Resets canvas with confirmation warning.
- **Edit**
  - Undo (`Ctrl+Z`): Steps backward in history stack.
  - Redo (`Ctrl+Y` or `Ctrl+Shift+Z`): Steps forward in history stack.
  - Cut (`Ctrl+X`): Copies selected layer pixels to clipboard buffer and clears region.
  - Copy (`Ctrl+C`): Copies selected layer pixels to clipboard buffer.
  - Paste (`Ctrl+V`): Pastes clipboard buffer as a floating selection / new layer.
  - Fill with FG Color (`Ctrl+,`): Fills selection or active layer with Foreground color.
  - Fill with BG Color (`Ctrl+.`): Fills selection or active layer with Background color.
  - Clear (`Delete` or `Backspace`): Erases selection area to transparent or background color.
- **Select**
  - All (`Ctrl+A`): Selects full document dimensions.
  - None (`Ctrl+Shift+A`): Clears active selection mask.
  - Invert (`Ctrl+I`): Inverts alpha selection mask ($mask' = 255 - mask$).
  - Feather...: Applies Gaussian blur to selection mask to soften edges.
- **View**
  - Zoom In (`+` or `=`)
  - Zoom Out (`-`)
  - Zoom 100% (`1`)
  - Fit Image to Window (`Ctrl+Shift+J` or `Shift+Ctrl+E`)
  - Toggle Grid (`Ctrl+'`)
  - Toggle Rulers (`Shift+Ctrl+R`)
- **Image**
  - Canvas Size...: Dialog to expand/shrink canvas boundaries with anchor positioning.
  - Scale Image...: Resamples entire document and all layers.
  - Flip Horizontally / Vertically
  - Rotate 90° CW / 90° CCW / 180°
  - Flatten Image: Merges all visible layers down to a single background layer.
- **Layer**
  - New Layer... (`Shift+Ctrl+N`): Opens dialog for layer name, width, height, fill mode.
  - Duplicate Layer (`Shift+Ctrl+D`): Clones active layer with contents.
  - Delete Layer: Removes active layer from stack.
  - Merge Down: Flattens active layer onto layer immediately below it.
  - Layer to Image Size: Resizes active layer boundaries to match canvas dimensions.
- **Colors**
  - Brightness-Contrast...
  - Exposure...
  - Hue-Saturation...
  - Levels...
  - Curves...
  - Invert
  - Desaturate / Grayscale...
  - Sepia...
- **Filters**
  - Blur -> Gaussian Blur...
  - Enhance -> Sharpen (Unsharp Mask)...
  - Edge-Detect -> Sobel...
  - Noise -> Add RGB Noise...
  - Distorts -> Pixelize...
- **Help**
  - Keyboard Shortcuts (`?` or `F1`): Quick modal reference of all hotkeys.
  - About Web-GIMP: Version info, Wilber mascot, credits.

---

## 7. GIMP Keyboard Shortcuts Specification

| Keybinding | Action / Command | Scope |
| :--- | :--- | :--- |
| `P` | Activate Paintbrush Tool | Global |
| `N` | Activate Pencil Tool | Global |
| `Shift + E` | Activate Eraser Tool | Global |
| `Shift + B` | Activate Bucket Fill Tool | Global |
| `G` | Activate Gradient Tool | Global |
| `R` | Activate Rectangle Select Tool | Global |
| `E` | Activate Ellipse Select Tool | Global |
| `F` | Activate Free Select (Lasso) Tool | Global |
| `U` | Activate Fuzzy Select (Magic Wand) | Global |
| `Shift + O` | Activate Select by Color | Global |
| `M` | Activate Move Tool | Global |
| `Shift + C` | Activate Crop Tool | Global |
| `Shift + R` | Activate Rotate Tool | Global |
| `Shift + S` | Activate Scale Tool | Global |
| `Shift + F` | Activate Flip Tool | Global |
| `C` | Activate Clone Tool | Global |
| `T` | Activate Text Tool | Global |
| `O` | Activate Color Picker (Eyedropper) | Global |
| `Z` | Activate Zoom Tool | Global |
| `Space` (Hold) | Temporary Pan / Hand drag mode | Canvas Viewport |
| `X` | Swap Foreground and Background Colors | Global |
| `D` | Reset Colors to Black (FG) and White (BG) | Global |
| `[` / `]` | Decrease / Increase Brush Size by 2px (or 10%) | Tool Options |
| `Ctrl + Z` | Undo | Document History |
| `Ctrl + Y` / `Ctrl + Shift + Z` | Redo | Document History |
| `Ctrl + A` | Select All | Selection |
| `Ctrl + Shift + A` | Select None (Deselect) | Selection |
| `Ctrl + I` | Invert Selection | Selection |
| `Delete` / `Backspace` | Clear / Delete selection | Active Layer |
| `Ctrl + C` / `Ctrl + X` / `Ctrl + V` | Copy, Cut, Paste | Clipboard |
| `Ctrl + N` | New Image Dialog | Project |
| `Ctrl + O` | Open Image File | Project |
| `Ctrl + S` | Save Project (.wgimp JSON) | Project |
| `Shift + Ctrl + E` | Export Image Dialog | Project |
| `+` / `-` | Zoom In / Zoom Out | Viewport |
| `1` | Zoom 100% Actual Pixels | Viewport |
| `Ctrl + Shift + J` | Fit Image in Window | Viewport |
| `Shift + Ctrl + N` | New Layer Dialog | Layer Stack |
| `Shift + Ctrl + D` | Duplicate Active Layer | Layer Stack |
| `Tab` | Toggle visibility of all docks/panels | Workspace UI |

---

## 8. Web-GIMP Project File Specification (`.wgimp`)

To support non-destructive project saving and loading, Web-GIMP serializes the complete workspace state to JSON:
```json
{
  "format": "web-gimp-project",
  "version": "1.0",
  "createdAt": "2026-11-20T00:00:00.000Z",
  "canvas": {
    "width": 1920,
    "height": 1080
  },
  "layers": [
    {
      "id": "layer-1732064000-0",
      "name": "Background",
      "visible": true,
      "locked": false,
      "opacity": 1.0,
      "blendMode": "source-over",
      "x": 0,
      "y": 0,
      "width": 1920,
      "height": 1080,
      "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
    },
    {
      "id": "layer-1732064000-1",
      "name": "Drawing Layer",
      "visible": true,
      "locked": false,
      "opacity": 0.85,
      "blendMode": "multiply",
      "x": 100,
      "y": 150,
      "width": 800,
      "height": 600,
      "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..."
    }
  ],
  "activeLayerIndex": 1
}
```

---

## 9. Implementation Roadmap & Task Distribution

### 9.1 Core Engine Team (`@core-dev`)
1. **`src/layers.js`**:
   - `Layer` class: Encapsulates offscreen canvas, dimensions, coordinates, visibility, opacity, blend modes, rendering methods, and pixel getters/setters.
   - `LayerManager` class: Manages layer array, reordering, adding, deleting, duplicating, merging down (`drawImage` with blend mode compositing), flattening, and active layer selection.
2. **`src/engine.js`**:
   - Document state manager: Dimensions, zoom, pan, active tool, foreground/background color.
   - Compositing engine: Iterates layer stack, draws to viewport canvas with proper transformations.
   - Selection mask buffer: 8-bit alpha canvas, selection operations (Add, Subtract, Intersect, Replace, Invert, Feather).
   - Undo/Redo stack: Snapshot manager serializing layers and selection states with depth pruning.
   - I/O Handlers: Project export/import (`.wgimp`), image export (PNG, JPEG with quality, WEBP), and image import.
3. **`src/filters.js`**:
   - Color adjustment functions: Brightness/Contrast, Exposure, HSL, Levels (with 256 LUT), Curves (spline LUT), Invert, Desaturate (Luminosity/Lightness/Average), Sepia.
   - Convolution & spatial filters: Separable Gaussian Blur, Sharpen/Unsharp Mask, Sobel Edge Detect, Pixelize, RGB Noise.
   - Live preview support: Performs filter on temporary canvas buffer to enable real-time slider scrubbing before committing to history.

### 9.2 UI & Tools Team (`@ui-dev`)
1. **`index.html` & `style.css`**:
   - Authentic GIMP desktop layout: Menu bar, horizontal and vertical rulers, center viewport canvas with checkered transparency pattern, Left dock (Toolbox + Tool Options), Right dock (Layers tab, Undo History tab, Brushes tab), and bottom Status Bar.
   - High-density dark charcoal theme (`#282828`, `#383838`, `#424242`, `#555555`).
   - Modal dialog system: Clean modal overlays for New Image, Canvas Size, Scale Image, Filter adjustments with real-time preview, Export options, and Keyboard Shortcuts.
2. **`src/tools.js`**:
   - Base `Tool` class and tool subclasses:
     - Selection tools: `RectSelectTool`, `EllipseSelectTool`, `LassoTool`, `MagicWandTool`, `SelectByColorTool`.
     - Paint tools: `BrushTool`, `PencilTool`, `EraserTool`, `BucketFillTool`, `GradientTool`, `CloneTool`.
     - Transform tools: `MoveTool`, `CropTool`, `RotateTool`, `ScaleTool`, `FlipTool`.
     - Utility tools: `TextTool`, `ColorPickerTool`, `ZoomTool`, `MeasureTool`.
   - Continuous stroke interpolation with brush dynamics (size, hardness, spacing).
3. **`src/ui.js`**:
   - Menu bar event wiring and dropdown popups.
   - Toolbox button state management and tool switching.
   - Tool Options dock: Dynamically re-renders sliders and inputs depending on the selected tool.
   - Layers dock: Thumbnail rendering, visibility eye toggle, opacity slider, blend mode select, reordering (Up/Down), Add, Duplicate, Merge, Delete.
   - History dock: Visual list of history snapshots with one-click restore.
   - Global keyboard shortcut dispatcher with event interception (`e.preventDefault()` for conflicting browser defaults like `Ctrl+S`, `Ctrl+O`, `Ctrl+A`).

### 9.3 Verification & Quality Assurance (`@verifier`)
1. **Syntax & Runtime Validation**:
   - Ensure zero JavaScript errors or syntax warnings in all modules.
   - Verify ES module compatibility and proper script imports.
2. **Feature Acceptance Matrix**:
   - Multi-layer manipulation (creation, reordering, opacity blending, merging).
   - Selection clipping (drawing operations restricted strictly to selection boundary).
   - Drawing tools (smooth strokes, pressure/speed consistency, erase to alpha).
   - Filter accuracy (correct mathematical color transformations, live preview responsive).
   - Project persistence (save and load `.wgimp`, verify layer attributes and pixels remain identical).
   - Export fidelity (PNG transparency preserved, JPEG compression matches selected quality).
3. **HTTP Server & Browser Smoke Test**:
   - Start local static server (e.g. `npx serve`, Python `http.server`, or Node static server).
   - Verify viewport responsiveness, canvas pan/zoom smoothness, and shortcut capture.

---

*Authored by @researcher for the Web-GIMP development swarm.*
