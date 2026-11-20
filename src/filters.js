/**
 * PixelForge Studio - Core Filter Engine
 * Comprehensive pixel manipulation, color adjustments, convolution kernels, and artistic filters.
 */

(function (root) {
  'use strict';

  root.PixelForge = root.PixelForge || {};
  root.GIMP = root.PixelForge; // Backward compatibility alias
  const Filters = {};

  // ==========================================
  // Helper Utilities
  // ==========================================

  function clamp(val, min = 0, max = 255) {
    return val < min ? min : (val > max ? max : val);
  }

  function cloneImageData(src) {
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    const copy = ctx.createImageData(src.width, src.height);
    copy.data.set(src.data);
    return copy;
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h * 360, s, l];
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  // ==========================================
  // 1. Color Adjustments
  // ==========================================

  /**
   * Brightness & Contrast Adjustment
   * @param {ImageData} imageData 
   * @param {Object} options { brightness: -100 to 100, contrast: -100 to 100 }
   */
  Filters.brightnessContrast = function (imageData, options = {}) {
    const brightness = Number(options.brightness || 0); // -100 to 100
    const contrast = Number(options.contrast || 0);     // -100 to 100

    if (brightness === 0 && contrast === 0) return imageData;

    const data = imageData.data;
    const len = data.length;

    // Contrast factor formula
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const bShift = brightness * (255 / 100);

    // Build 256-entry lookup table (LUT)
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let val = factor * (i - 128) + 128 + bShift;
      lut[i] = clamp(Math.round(val), 0, 255);
    }

    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }

    return imageData;
  };

  /**
   * Exposure Adjustment
   * @param {ImageData} imageData 
   * @param {Object} options { exposure: -5 to 5, offset: -0.5 to 0.5, gamma: 0.1 to 3.0 }
   */
  Filters.exposure = function (imageData, options = {}) {
    const exposure = Number(options.exposure || 0);
    const offset = Number(options.offset || 0);
    const gamma = Number(options.gamma || 1.0);

    const mult = Math.pow(2, exposure);
    const invGamma = 1 / Math.max(0.01, gamma);

    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let val = (i / 255) * mult + offset;
      if (val > 0) {
        val = Math.pow(val, invGamma);
      } else {
        val = 0;
      }
      lut[i] = clamp(Math.round(val * 255), 0, 255);
    }

    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }

    return imageData;
  };

  /**
   * Levels Adjustment (Input Black, Input White, Gamma, Output Black, Output White)
   * @param {ImageData} imageData 
   * @param {Object} options { inBlack: 0-255, inWhite: 0-255, gamma: 0.1-5.0, outBlack: 0-255, outWhite: 0-255 }
   */
  Filters.levels = function (imageData, options = {}) {
    const inBlack = Math.max(0, Math.min(254, Number(options.inBlack || 0)));
    const inWhite = Math.max(inBlack + 1, Math.min(255, Number(options.inWhite || 255)));
    const gamma = Math.max(0.1, Number(options.gamma || 1.0));
    const outBlack = Math.max(0, Math.min(255, Number(options.outBlack || 0)));
    const outWhite = Math.max(0, Math.min(255, Number(options.outWhite || 255)));

    const inRange = inWhite - inBlack;
    const outRange = outWhite - outBlack;
    const invGamma = 1 / gamma;

    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let normalized = (i - inBlack) / inRange;
      normalized = Math.max(0, Math.min(1, normalized));
      const gammaCorrected = Math.pow(normalized, invGamma);
      lut[i] = clamp(Math.round(outBlack + gammaCorrected * outRange), 0, 255);
    }

    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }

    return imageData;
  };

  /**
   * Curves Adjustment
   * @param {ImageData} imageData 
   * @param {Object} options { rgbLUT: Array(256), rLUT: Array(256), gLUT: Array(256), bLUT: Array(256) }
   */
  Filters.curves = function (imageData, options = {}) {
    const rgbLUT = options.rgbLUT;
    const rLUT = options.rLUT;
    const gLUT = options.gLUT;
    const bLUT = options.bLUT;

    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (rgbLUT) {
        r = rgbLUT[r];
        g = rgbLUT[g];
        b = rgbLUT[b];
      }
      if (rLUT) r = rLUT[r];
      if (gLUT) g = gLUT[g];
      if (bLUT) b = bLUT[b];

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }

    return imageData;
  };

  /**
   * Hue / Saturation / Lightness Adjustment
   * @param {ImageData} imageData 
   * @param {Object} options { hue: -180 to 180, saturation: -100 to 100, lightness: -100 to 100 }
   */
  Filters.hueSaturation = function (imageData, options = {}) {
    const hueDelta = Number(options.hue || 0);
    const satDelta = Number(options.saturation || 0) / 100;
    const lightDelta = Number(options.lightness || 0) / 100;

    if (hueDelta === 0 && satDelta === 0 && lightDelta === 0) return imageData;

    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      let [h, s, l] = rgbToHsl(r, g, b);

      h = (h + hueDelta) % 360;
      if (h < 0) h += 360;

      s = Math.max(0, Math.min(1, s * (1 + satDelta)));
      
      if (lightDelta > 0) {
        l = l + (1 - l) * lightDelta;
      } else if (lightDelta < 0) {
        l = l + l * lightDelta;
      }
      l = Math.max(0, Math.min(1, l));

      const [newR, newG, newB] = hslToRgb(h, s, l);
      data[i] = newR;
      data[i + 1] = newG;
      data[i + 2] = newB;
    }

    return imageData;
  };

  /**
   * Color Balance
   * @param {ImageData} imageData 
   * @param {Object} options { cyanRed: -100 to 100, magentaGreen: -100 to 100, yellowBlue: -100 to 100 }
   */
  Filters.colorBalance = function (imageData, options = {}) {
    const cr = Number(options.cyanRed || 0) * 1.28;
    const mg = Number(options.magentaGreen || 0) * 1.28;
    const yb = Number(options.yellowBlue || 0) * 1.28;

    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      data[i] = clamp(data[i] + cr);
      data[i + 1] = clamp(data[i + 1] + mg);
      data[i + 2] = clamp(data[i + 2] + yb);
    }

    return imageData;
  };

  /**
   * Invert Colors
   * @param {ImageData} imageData 
   */
  Filters.invert = function (imageData) {
    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }
    return imageData;
  };

  /**
   * Grayscale / Desaturate
   * @param {ImageData} imageData 
   * @param {Object} options { mode: 'luminance' | 'average' | 'lightness' }
   */
  Filters.grayscale = function (imageData, options = {}) {
    const mode = options.mode || 'luminance';
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      let gray = 0;

      if (mode === 'average') {
        gray = Math.round((r + g + b) / 3);
      } else if (mode === 'lightness') {
        gray = Math.round((Math.max(r, g, b) + Math.min(r, g, b)) / 2);
      } else {
        // Luminance (Rec. 709)
        gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }

      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    return imageData;
  };

  /**
   * Sepia Tone
   * @param {ImageData} imageData 
   * @param {Object} options { amount: 0 to 1 or 0 to 100 }
   */
  Filters.sepia = function (imageData, options = {}) {
    let amount = options.amount !== undefined ? Number(options.amount) : 1.0;
    if (amount > 1) amount /= 100;
    amount = Math.max(0, Math.min(1, amount));
    const inv = 1 - amount;
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;

      data[i] = clamp(Math.round(sr * amount + r * inv));
      data[i + 1] = clamp(Math.round(sg * amount + g * inv));
      data[i + 2] = clamp(Math.round(sb * amount + b * inv));
    }

    return imageData;
  };

  /**
   * Threshold (Binary Black & White)
   * @param {ImageData} imageData 
   * @param {Object} options { threshold: 0-255 }
   */
  Filters.threshold = function (imageData, options = {}) {
    const thresh = options.threshold !== undefined ? Number(options.threshold) : 128;
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const val = lum >= thresh ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }

    return imageData;
  };

  /**
   * Posterize (Reduce tonal depth)
   * @param {ImageData} imageData 
   * @param {Object} options { levels: 2 to 32 }
   */
  Filters.posterize = function (imageData, options = {}) {
    const levels = Math.max(2, Math.min(32, parseInt(options.levels, 10) || 4));
    const step = 255 / (levels - 1);

    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(Math.round(i / step) * step);
    }

    const data = imageData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }

    return imageData;
  };

  // ==========================================
  // 2. Convolution & Blurs
  // ==========================================

  /**
   * Apply 2D Convolution Matrix with clamped coordinate edge handling
   */
  Filters.applyConvolution = function (imageData, kernel, factor = 1, bias = 0) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const output = cloneImageData(imageData);
    const dst = output.data;

    const kSize = Math.round(Math.sqrt(kernel.length));
    const half = Math.floor(kSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0;

        for (let ky = 0; ky < kSize; ky++) {
          const iy = clamp(y + ky - half, 0, height - 1);
          for (let kx = 0; kx < kSize; kx++) {
            const ix = clamp(x + kx - half, 0, width - 1);
            const srcIdx = (iy * width + ix) * 4;
            const weight = kernel[ky * kSize + kx];

            r += src[srcIdx] * weight;
            g += src[srcIdx + 1] * weight;
            b += src[srcIdx + 2] * weight;
          }
        }

        const dstIdx = (y * width + x) * 4;
        dst[dstIdx] = clamp(Math.round(r * factor + bias));
        dst[dstIdx + 1] = clamp(Math.round(g * factor + bias));
        dst[dstIdx + 2] = clamp(Math.round(b * factor + bias));
        dst[dstIdx + 3] = src[dstIdx + 3]; // Preserve alpha
      }
    }

    imageData.data.set(dst);
    return imageData;
  };

  /**
   * Fast Separable Gaussian Blur (Horizontal pass + Vertical pass)
   * @param {ImageData} imageData 
   * @param {Object} options { radius: 1 to 50 }
   */
  Filters.gaussianBlur = function (imageData, options = {}) {
    let radius = Math.max(1, Math.min(50, Math.round(options.radius || 3)));
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;

    // Create 1D Gaussian kernel
    const sigma = radius / 2.5;
    const kSize = radius * 2 + 1;
    const kernel = new Float32Array(kSize);
    let sum = 0;
    for (let i = 0; i < kSize; i++) {
      const x = i - radius;
      const g = Math.exp(-(x * x) / (2 * sigma * sigma));
      kernel[i] = g;
      sum += g;
    }
    for (let i = 0; i < kSize; i++) {
      kernel[i] /= sum;
    }

    // Intermediate buffer for separable pass
    const tempBuffer = new Float32Array(width * height * 4);

    // Pass 1: Horizontal blur
    for (let y = 0; y < height; y++) {
      const yOffset = y * width;
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0, a = 0;

        for (let k = 0; k < kSize; k++) {
          const ix = clamp(x + k - radius, 0, width - 1);
          const idx = (yOffset + ix) * 4;
          const weight = kernel[k];

          r += src[idx] * weight;
          g += src[idx + 1] * weight;
          b += src[idx + 2] * weight;
          a += src[idx + 3] * weight;
        }

        const outIdx = (yOffset + x) * 4;
        tempBuffer[outIdx] = r;
        tempBuffer[outIdx + 1] = g;
        tempBuffer[outIdx + 2] = b;
        tempBuffer[outIdx + 3] = a;
      }
    }

    // Pass 2: Vertical blur from tempBuffer into src
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let r = 0, g = 0, b = 0, a = 0;

        for (let k = 0; k < kSize; k++) {
          const iy = clamp(y + k - radius, 0, height - 1);
          const idx = (iy * width + x) * 4;
          const weight = kernel[k];

          r += tempBuffer[idx] * weight;
          g += tempBuffer[idx + 1] * weight;
          b += tempBuffer[idx + 2] * weight;
          a += tempBuffer[idx + 3] * weight;
        }

        const outIdx = (y * width + x) * 4;
        src[outIdx] = clamp(Math.round(r));
        src[outIdx + 1] = clamp(Math.round(g));
        src[outIdx + 2] = clamp(Math.round(b));
        src[outIdx + 3] = clamp(Math.round(a));
      }
    }

    return imageData;
  };

  /**
   * Sharpen Filter
   * @param {ImageData} imageData 
   * @param {Object} options { amount: 0.1 to 3.0 }
   */
  Filters.sharpen = function (imageData, options = {}) {
    const amount = Number(options.amount || 1.0);
    const kernel = [
      0, -amount, 0,
      -amount, 1 + 4 * amount, -amount,
      0, -amount, 0
    ];
    return Filters.applyConvolution(imageData, kernel, 1, 0);
  };

  /**
   * Unsharp Mask Filter
   * @param {ImageData} imageData 
   * @param {Object} options { radius: 1-10, amount: 0.1-5.0, threshold: 0-50 }
   */
  Filters.unsharpMask = function (imageData, options = {}) {
    const radius = options.radius || 2;
    const amount = options.amount !== undefined ? Number(options.amount) : 1.5;
    const threshold = Number(options.threshold || 0);

    const blurred = cloneImageData(imageData);
    Filters.gaussianBlur(blurred, { radius });

    const src = imageData.data;
    const blurData = blurred.data;
    const len = src.length;

    for (let i = 0; i < len; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = src[i + c] - blurData[i + c];
        if (Math.abs(diff) >= threshold) {
          src[i + c] = clamp(Math.round(src[i + c] + diff * amount));
        }
      }
    }

    return imageData;
  };

  /**
   * Edge Detect (Sobel Gradient)
   * @param {ImageData} imageData 
   * @param {Object} options { amount: 0.5 to 3.0, invert: boolean }
   */
  Filters.edgeDetect = function (imageData, options = {}) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const output = cloneImageData(imageData);
    const dst = output.data;
    const amount = Number(options.amount || 1.0);
    const doInvert = !!options.invert;

    // Sobel kernels
    // Gx: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
    // Gy: [[-1, -2, -1], [ 0,  0,  0], [ 1,  2,  1]]

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let gx = 0, gy = 0;

        for (let ky = -1; ky <= 1; ky++) {
          const iy = clamp(y + ky, 0, height - 1);
          for (let kx = -1; kx <= 1; kx++) {
            const ix = clamp(x + kx, 0, width - 1);
            const idx = (iy * width + ix) * 4;
            const lum = 0.2126 * src[idx] + 0.7152 * src[idx + 1] + 0.0722 * src[idx + 2];

            // Gx weight
            const wx = (kx === 0 ? 0 : kx) * (ky === 0 ? 2 : 1);
            // Gy weight
            const wy = (ky === 0 ? 0 : ky) * (kx === 0 ? 2 : 1);

            gx += lum * wx;
            gy += lum * wy;
          }
        }

        let mag = Math.hypot(gx, gy) * amount;
        mag = clamp(Math.round(mag));

        if (doInvert) {
          mag = 255 - mag;
        }

        const dstIdx = (y * width + x) * 4;
        dst[dstIdx] = mag;
        dst[dstIdx + 1] = mag;
        dst[dstIdx + 2] = mag;
        dst[dstIdx + 3] = src[dstIdx + 3];
      }
    }

    imageData.data.set(dst);
    return imageData;
  };

  /**
   * Emboss Filter
   * @param {ImageData} imageData 
   * @param {Object} options { depth: 1 to 5 }
   */
  Filters.emboss = function (imageData, options = {}) {
    const depth = Number(options.depth || 1.0);
    const kernel = [
      -2 * depth, -1 * depth, 0,
      -1 * depth, 1, 1 * depth,
      0, 1 * depth, 2 * depth
    ];
    return Filters.applyConvolution(imageData, kernel, 1, 128);
  };

  // ==========================================
  // 3. Artistic & Noise
  // ==========================================

  /**
   * Add Noise Filter
   * @param {ImageData} imageData 
   * @param {Object} options { amount: 1 to 100, monochromatic: boolean }
   */
  Filters.noise = function (imageData, options = {}) {
    const amount = Number(options.amount || 25);
    const mono = !!options.monochromatic;
    const data = imageData.data;
    const len = data.length;

    for (let i = 0; i < len; i += 4) {
      if (mono) {
        const n = (Math.random() - 0.5) * 2 * amount;
        data[i] = clamp(data[i] + n);
        data[i + 1] = clamp(data[i + 1] + n);
        data[i + 2] = clamp(data[i + 2] + n);
      } else {
        data[i] = clamp(data[i] + (Math.random() - 0.5) * 2 * amount);
        data[i + 1] = clamp(data[i + 1] + (Math.random() - 0.5) * 2 * amount);
        data[i + 2] = clamp(data[i + 2] + (Math.random() - 0.5) * 2 * amount);
      }
    }

    return imageData;
  };

  /**
   * Pixelize / Mosaic Filter
   * @param {ImageData} imageData 
   * @param {Object} options { size: 2 to 64 }
   */
  Filters.pixelize = function (imageData, options = {}) {
    const size = Math.max(2, Math.min(64, parseInt(options.size, 10) || 10));
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
        let count = 0;

        const maxY = Math.min(y + size, height);
        const maxX = Math.min(x + size, width);

        // Calculate average block color
        for (let by = y; by < maxY; by++) {
          for (let bx = x; bx < maxX; bx++) {
            const idx = (by * width + bx) * 4;
            rSum += data[idx];
            gSum += data[idx + 1];
            bSum += data[idx + 2];
            aSum += data[idx + 3];
            count++;
          }
        }

        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);
        const avgA = Math.round(aSum / count);

        // Fill block with average color
        for (let by = y; by < maxY; by++) {
          for (let bx = x; bx < maxX; bx++) {
            const idx = (by * width + bx) * 4;
            data[idx] = avgR;
            data[idx + 1] = avgG;
            data[idx + 2] = avgB;
            data[idx + 3] = avgA;
          }
        }
      }
    }

    return imageData;
  };

  /**
   * Vignette Filter
   * @param {ImageData} imageData 
   * @param {Object} options { radius: 0.1 to 1.5, softness: 0.1 to 1.0 }
   */
  Filters.vignette = function (imageData, options = {}) {
    const radius = Number(options.radius || 0.8);
    const softness = Math.max(0.01, Number(options.softness || 0.45));
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.hypot(cx, cy);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.hypot(x - cx, y - cy) / maxDist;
        let factor = 1.0;

        if (dist > radius - softness) {
          const t = (dist - (radius - softness)) / softness;
          factor = Math.max(0, 1 - Math.min(1, t));
        }

        const idx = (y * width + x) * 4;
        data[idx] = Math.round(data[idx] * factor);
        data[idx + 1] = Math.round(data[idx + 1] * factor);
        data[idx + 2] = Math.round(data[idx + 2] * factor);
      }
    }

    return imageData;
  };

  // ==========================================
  // 4. Filter Application & Preview Helpers
  // ==========================================

  /**
   * Applies any registered filter to a target Layer canvas, with optional selection mask support.
   * @param {Layer} layer 
   * @param {string} filterName 
   * @param {Object} options 
   * @param {ImageData|Object} selectionMask optional mask
   */
  Filters.applyFilterToLayer = function (layer, filterName, options = {}, selectionMask = null) {
    if (!layer || !Filters[filterName]) {
      console.error(`Filter "${filterName}" not found or invalid layer.`);
      return false;
    }

    const w = layer.width;
    const h = layer.height;
    const imageData = layer.getImageData(0, 0, w, h);

    if (selectionMask && selectionMask.data) {
      // Filter a copy, then blend only selected pixels back
      const original = cloneImageData(imageData);
      Filters[filterName](imageData, options);

      const src = imageData.data;
      const orig = original.data;
      const mask = selectionMask.data;
      const len = src.length;

      for (let i = 0; i < len; i += 4) {
        const maskAlpha = mask[i + 3] / 255;
        if (maskAlpha === 0) {
          src[i] = orig[i];
          src[i + 1] = orig[i + 1];
          src[i + 2] = orig[i + 2];
          src[i + 3] = orig[i + 3];
        } else if (maskAlpha < 1.0) {
          src[i] = Math.round(src[i] * maskAlpha + orig[i] * (1 - maskAlpha));
          src[i + 1] = Math.round(src[i + 1] * maskAlpha + orig[i + 1] * (1 - maskAlpha));
          src[i + 2] = Math.round(src[i + 2] * maskAlpha + orig[i + 2] * (1 - maskAlpha));
          src[i + 3] = orig[i + 3];
        }
      }
    } else {
      Filters[filterName](imageData, options);
    }

    layer.putImageData(imageData, 0, 0);
    return true;
  };

  /**
   * Generate an offscreen preview of a filter for real-time dialog preview.
   * @param {Layer|HTMLCanvasElement|ImageData} source 
   * @param {string} filterName 
   * @param {Object} options 
   * @param {number} maxDim 
   * @returns {HTMLCanvasElement} preview canvas
   */
  Filters.previewFilter = function (source, filterName, options = {}, maxDim = 320) {
    if (!Filters[filterName]) return null;

    let srcCanvas = source.canvas || source;
    let w = srcCanvas.width;
    let h = srcCanvas.height;

    const scale = Math.min(1.0, maxDim / Math.max(w, h));
    const pw = Math.max(1, Math.round(w * scale));
    const ph = Math.max(1, Math.round(h * scale));

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = pw;
    previewCanvas.height = ph;
    const pCtx = previewCanvas.getContext('2d');

    pCtx.drawImage(srcCanvas, 0, 0, pw, ph);
    const previewData = pCtx.getImageData(0, 0, pw, ph);

    Filters[filterName](previewData, options);
    pCtx.putImageData(previewData, 0, 0);

    return previewCanvas;
  };

  // Aliases for UI compatibility
  Filters.desaturate = Filters.grayscale;
  Filters.sobel = Filters.edgeDetect;
  Filters.blur = Filters.gaussianBlur;

  // Export to PixelForge and backward-compatible GIMP namespace
  root.PixelForge.Filters = Filters;
  root.GIMP.Filters = Filters;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Filters;
  }
})(typeof window !== 'undefined' ? window : globalThis);
