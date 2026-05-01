function unpackDXT1Block(block, row, col, out, stride, hasAlpha, skipAlpha) {
    const c0 = block[0] | (block[1] << 8);
    const c1 = block[2] | (block[3] << 8);

    const r0 = ((c0 >> 11) & 0x1F) * 255 / 31 | 0;
    const g0 = ((c0 >>  5) & 0x3F) * 255 / 63 | 0;
    const b0 =  (c0        & 0x1F) * 255 / 31 | 0;

    const r1 = ((c1 >> 11) & 0x1F) * 255 / 31 | 0;
    const g1 = ((c1 >>  5) & 0x3F) * 255 / 63 | 0;
    const b1 =  (c1        & 0x1F) * 255 / 31 | 0;

    const palette = new Uint8Array(16);
    palette[0]  = r0; palette[1]  = g0; palette[2]  = b0; palette[3]  = 255;
    palette[4]  = r1; palette[5]  = g1; palette[6]  = b1; palette[7]  = 255;

    if (c0 > c1) {
        palette[8]  = (2*r0 + r1 + 1) / 3 | 0;
        palette[9]  = (2*g0 + g1 + 1) / 3 | 0;
        palette[10] = (2*b0 + b1 + 1) / 3 | 0;
        palette[11] = 255;
        palette[12] = (r0 + 2*r1 + 1) / 3 | 0;
        palette[13] = (g0 + 2*g1 + 1) / 3 | 0;
        palette[14] = (b0 + 2*b1 + 1) / 3 | 0;
        palette[15] = 255;
    } else {
        palette[8]  = (r0 + r1) >> 1;
        palette[9]  = (g0 + g1) >> 1;
        palette[10] = (b0 + b1) >> 1;
        palette[11] = 255;
        palette[12] = 0; palette[13] = 0; palette[14] = 0;
        palette[15] = hasAlpha ? 0 : 255;
    }

    const bits = block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24);
    for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
            const idx = (bits >> (2 * (py * 4 + px))) & 3;
            const di  = ((row + py) * stride + (col + px)) * 4;
            out[di]   = palette[idx * 4];
            out[di+1] = palette[idx * 4 + 1];
            out[di+2] = palette[idx * 4 + 2];
            if (!skipAlpha) out[di+3] = palette[idx * 4 + 3];
        }
    }
}

function unpackDXT5AlphaBlock(block, row, col, out, stride) {
    const a0 = block[0], a1 = block[1];
    const ap = new Uint8Array(8);
    ap[0] = a0; ap[1] = a1;
    if (a0 > a1) {
        ap[2] = (6*a0 + 1*a1 + 3) / 7 | 0;
        ap[3] = (5*a0 + 2*a1 + 3) / 7 | 0;
        ap[4] = (4*a0 + 3*a1 + 3) / 7 | 0;
        ap[5] = (3*a0 + 4*a1 + 3) / 7 | 0;
        ap[6] = (2*a0 + 5*a1 + 3) / 7 | 0;
        ap[7] = (1*a0 + 6*a1 + 3) / 7 | 0;
    } else {
        ap[2] = (4*a0 + 1*a1 + 2) / 5 | 0;
        ap[3] = (3*a0 + 2*a1 + 2) / 5 | 0;
        ap[4] = (2*a0 + 3*a1 + 2) / 5 | 0;
        ap[5] = (1*a0 + 4*a1 + 2) / 5 | 0;
        ap[6] = 0; ap[7] = 255;
    }

    const lo = block[2] | (block[3] << 8) | (block[4] << 16);
    const hi = block[5] | (block[6] << 8) | (block[7] << 16);
    for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
            const bit = py * 4 + px;
            const idx = bit < 8
                ? (lo >> (bit * 3)) & 7
                : (hi >> ((bit - 8) * 3)) & 7;
            const di = ((row + py) * stride + (col + px)) * 4 + 3;
            out[di] = ap[idx];
        }
    }
}

function decodeDXT1(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    let src_i = 0;
    for (let row = 0; row < h; row += 4) {
        for (let col = 0; col < w; col += 4) {
            unpackDXT1Block(src.subarray(src_i, src_i + 8), row, col, out, w, false);
            src_i += 8;
        }
    }
    return out;
}

function decodeDXT5(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    let src_i = 0;
    for (let row = 0; row < h; row += 4) {
        for (let col = 0; col < w; col += 4) {
            unpackDXT5AlphaBlock(src.subarray(src_i,     src_i + 8),  row, col, out, w);
            unpackDXT1Block     (src.subarray(src_i + 8, src_i + 16), row, col, out, w, true, true);
            src_i += 16;
        }
    }
    return out;
}

function decodeRGB24(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    const n = w * h;
    for (let i = 0; i < n; i++) {
        out[i*4]   = src[i*3];
        out[i*4+1] = src[i*3+1];
        out[i*4+2] = src[i*3+2];
        out[i*4+3] = 255;
    }
    return out;
}

function decodeRGBA32(src, w, h) {
    const needed = w * h * 4;
    if (src.length >= needed) return src.subarray(0, needed);
    const out = new Uint8Array(needed);
    out.set(src.subarray(0, Math.min(src.length, needed)));
    return out;
}

function decodeARGB32(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    const n = w * h;
    for (let i = 0; i < n; i++) {
        out[i*4]   = src[i*4+1];
        out[i*4+1] = src[i*4+2];
        out[i*4+2] = src[i*4+3];
        out[i*4+3] = src[i*4];
    }
    return out;
}

function decodeBGRA32(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    const n = w * h;
    for (let i = 0; i < n; i++) {
        out[i*4]   = src[i*4+2];
        out[i*4+1] = src[i*4+1];
        out[i*4+2] = src[i*4];
        out[i*4+3] = src[i*4+3];
    }
    return out;
}

function decodeRGB565(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const n = w * h;
    for (let i = 0; i < n; i++) {
        const px = view.getUint16(i * 2, true);
        out[i*4]   = ((px >> 11) & 0x1F) * 255 / 31 | 0;
        out[i*4+1] = ((px >>  5) & 0x3F) * 255 / 63 | 0;
        out[i*4+2] =  (px        & 0x1F) * 255 / 31 | 0;
        out[i*4+3] = 255;
    }
    return out;
}

function decodeAlpha8(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    const n = w * h;
    for (let i = 0; i < n; i++) {
        out[i*4]   = 255;
        out[i*4+1] = 255;
        out[i*4+2] = 255;
        out[i*4+3] = src[i];
    }
    return out;
}

function decodeARGB4444(src, w, h) {
    const out = new Uint8Array(w * h * 4);
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const n = w * h;
    for (let i = 0; i < n; i++) {
        const px = view.getUint16(i * 2, true);
        const a = (px >> 12) & 0xF;
        const r = (px >>  8) & 0xF;
        const g = (px >>  4) & 0xF;
        const b =  px        & 0xF;
        out[i*4]   = r * 17;
        out[i*4+1] = g * 17;
        out[i*4+2] = b * 17;
        out[i*4+3] = a * 17;
    }
    return out;
}

export function decodeTexture2D(imageData, width, height, fmt) {
    if (!imageData || imageData.length === 0 || width <= 0 || height <= 0) return null;
    const w = width, h = height;
    let rgba;
    try {
        switch (fmt) {
            case 1:  rgba = decodeAlpha8  (imageData, w, h); break;
            case 2:  rgba = decodeARGB4444(imageData, w, h); break;
            case 3:  rgba = decodeRGB24   (imageData, w, h); break;
            case 4:  rgba = decodeRGBA32  (imageData, w, h); break;
            case 5:  rgba = decodeARGB32  (imageData, w, h); break;
            case 7:  rgba = decodeRGB565  (imageData, w, h); break;
            case 9: {
                const out = new Uint8Array(w*h*4);
                const view = new DataView(imageData.buffer, imageData.byteOffset, imageData.byteLength);
                for (let i=0;i<w*h;i++) {
                    const v = Math.round(view.getUint16(i*2,true)/65535*255);
                    out[i*4]=v; out[i*4+1]=v; out[i*4+2]=v; out[i*4+3]=255;
                }
                rgba = out; break;
            }
            case 10: rgba = decodeDXT1   (imageData, w, h); break;
            case 12: rgba = decodeDXT5   (imageData, w, h); break;
            case 13: rgba = decodeARGB4444(imageData, w, h); break;
            case 14: rgba = decodeBGRA32 (imageData, w, h); break;
            case 34: case 35: case 36: case 37:
            case 38: case 51: case 52: case 53: {
                rgba = new Uint8Array(w*h*4);
                for (let i=0;i<w*h;i++) { rgba[i*4]=180; rgba[i*4+1]=180; rgba[i*4+2]=180; rgba[i*4+3]=255; }
                break;
            }
            default: return null;
        }
    } catch { return null; }

    if (!rgba) return null;
    const canvas = new OffscreenCanvas(w, h);
    const ctx    = canvas.getContext('2d');
    const id     = ctx.createImageData(w, h);
    id.data.set(rgba);
    ctx.putImageData(id, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
}
