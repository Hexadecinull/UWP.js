function interleave(positions, normals, uvs) {
    const n = positions.length / 3;
    const out = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
        out[i*8+0] = positions[i*3+0];
        out[i*8+1] = positions[i*3+1];
        out[i*8+2] = positions[i*3+2];
        out[i*8+3] = normals[i*3+0];
        out[i*8+4] = normals[i*3+1];
        out[i*8+5] = normals[i*3+2];
        out[i*8+6] = uvs ? uvs[i*2+0] : 0;
        out[i*8+7] = uvs ? uvs[i*2+1] : 0;
    }
    return out;
}

export function makeCube() {
    const faces = [
        { n: [ 0, 0, 1], u: [0,0, 1,0, 1,1, 0,1], v: [[-0.5,-0.5, 0.5],[ 0.5,-0.5, 0.5],[ 0.5, 0.5, 0.5],[-0.5, 0.5, 0.5]] },
        { n: [ 0, 0,-1], u: [1,0, 0,0, 0,1, 1,1], v: [[ 0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5, 0.5,-0.5],[ 0.5, 0.5,-0.5]] },
        { n: [-1, 0, 0], u: [0,0, 1,0, 1,1, 0,1], v: [[-0.5,-0.5,-0.5],[-0.5,-0.5, 0.5],[-0.5, 0.5, 0.5],[-0.5, 0.5,-0.5]] },
        { n: [ 1, 0, 0], u: [1,0, 0,0, 0,1, 1,1], v: [[ 0.5,-0.5, 0.5],[ 0.5,-0.5,-0.5],[ 0.5, 0.5,-0.5],[ 0.5, 0.5, 0.5]] },
        { n: [ 0, 1, 0], u: [0,1, 1,1, 1,0, 0,0], v: [[-0.5, 0.5, 0.5],[ 0.5, 0.5, 0.5],[ 0.5, 0.5,-0.5],[-0.5, 0.5,-0.5]] },
        { n: [ 0,-1, 0], u: [0,0, 1,0, 1,1, 0,1], v: [[-0.5,-0.5,-0.5],[ 0.5,-0.5,-0.5],[ 0.5,-0.5, 0.5],[-0.5,-0.5, 0.5]] },
    ];
    const pos = [], nrm = [], uv = [];
    const idx = [];
    let base = 0;
    for (const f of faces) {
        for (let i = 0; i < 4; i++) {
            pos.push(...f.v[i]);
            nrm.push(...f.n);
            uv.push(f.u[i*2], f.u[i*2+1]);
        }
        idx.push(base, base+1, base+2, base, base+2, base+3);
        base += 4;
    }
    return {
        vertices: interleave(pos, nrm, uv),
        indices:  new Uint16Array(idx),
        name: 'Cube',
    };
}

export function makeSphere(latSegs = 16, lonSegs = 16) {
    const pos = [], nrm = [], uv = [];
    const idx = [];
    for (let lat = 0; lat <= latSegs; lat++) {
        const theta = lat * Math.PI / latSegs;
        const sinT  = Math.sin(theta), cosT = Math.cos(theta);
        for (let lon = 0; lon <= lonSegs; lon++) {
            const phi  = lon * 2 * Math.PI / lonSegs;
            const sinP = Math.sin(phi), cosP = Math.cos(phi);
            const x = cosP * sinT, y = cosT, z = sinP * sinT;
            pos.push(x * 0.5, y * 0.5, z * 0.5);
            nrm.push(x, y, z);
            uv.push(lon / lonSegs, 1 - lat / latSegs);
        }
    }
    for (let lat = 0; lat < latSegs; lat++) {
        for (let lon = 0; lon < lonSegs; lon++) {
            const a = lat * (lonSegs + 1) + lon;
            const b = a + lonSegs + 1;
            idx.push(a, b, a+1, b, b+1, a+1);
        }
    }
    return {
        vertices: interleave(pos, nrm, uv),
        indices:  new Uint16Array(idx),
        name: 'Sphere',
    };
}

export function makeCylinder(segs = 24, height = 2, radius = 0.5) {
    const pos = [], nrm = [], uv = [];
    const idx = [];
    const halfH = height * 0.5;

    for (let ring = 0; ring <= 1; ring++) {
        const y = ring === 0 ? -halfH : halfH;
        for (let s = 0; s <= segs; s++) {
            const phi = s * 2 * Math.PI / segs;
            const x   = Math.cos(phi) * radius;
            const z   = Math.sin(phi) * radius;
            pos.push(x, y, z);
            nrm.push(Math.cos(phi), 0, Math.sin(phi));
            uv.push(s / segs, ring);
        }
    }

    for (let s = 0; s < segs; s++) {
        const a = s, b = s + segs + 1;
        idx.push(a, b, a+1, b, b+1, a+1);
    }

    function cap(yPos, capNY) {
        const ci = pos.length / 3;
        pos.push(0, yPos, 0); nrm.push(0, capNY, 0); uv.push(0.5, 0.5);
        for (let s = 0; s <= segs; s++) {
            const phi = s * 2 * Math.PI / segs;
            pos.push(Math.cos(phi) * radius, yPos, Math.sin(phi) * radius);
            nrm.push(0, capNY, 0);
            uv.push(0.5 + 0.5 * Math.cos(phi), 0.5 + 0.5 * Math.sin(phi));
        }
        const ci2 = ci + 1;
        for (let s = 0; s < segs; s++) {
            if (capNY > 0) idx.push(ci, ci2+s, ci2+s+1);
            else           idx.push(ci, ci2+s+1, ci2+s);
        }
    }

    cap(-halfH, -1);
    cap( halfH,  1);

    return {
        vertices: interleave(pos, nrm, uv),
        indices:  new Uint16Array(idx),
        name: 'Cylinder',
    };
}

export function makeCapsule(segs = 16, height = 2, radius = 0.5) {
    const pos = [], nrm = [], uv = [];
    const idx = [];
    const halfCyl = Math.max(0, height * 0.5 - radius);
    const latHemi = Math.ceil(segs / 4);

    function hemisphere(yOffset, flip) {
        const base = pos.length / 3;
        for (let lat = 0; lat <= latHemi; lat++) {
            const theta = (lat / latHemi) * Math.PI * 0.5;
            const sinT  = Math.sin(theta), cosT = Math.cos(theta);
            const y     = flip ? -cosT * radius + yOffset : cosT * radius + yOffset;
            const yn    = flip ? -cosT : cosT;
            for (let lon = 0; lon <= segs; lon++) {
                const phi = lon * 2 * Math.PI / segs;
                const x   = Math.cos(phi) * sinT * radius;
                const z   = Math.sin(phi) * sinT * radius;
                pos.push(x, y, z);
                nrm.push(Math.cos(phi) * sinT, yn, Math.sin(phi) * sinT);
                uv.push(lon / segs, flip ? lat / latHemi * 0.25 : 0.75 + lat / latHemi * 0.25);
            }
        }
        for (let lat = 0; lat < latHemi; lat++) {
            for (let lon = 0; lon < segs; lon++) {
                const a = base + lat * (segs + 1) + lon;
                const b = a + segs + 1;
                if (flip) idx.push(a, a+1, b, b, a+1, b+1);
                else      idx.push(a, b, a+1, b, b+1, a+1);
            }
        }
    }

    hemisphere( halfCyl, false);
    hemisphere(-halfCyl, true);

    const ringStart = (latHemi + 1) * (segs + 1);
    const rings = 4;
    const baseRing = pos.length / 3;
    for (let r = 0; r <= rings; r++) {
        const y = -halfCyl + r * (halfCyl * 2) / rings;
        for (let s = 0; s <= segs; s++) {
            const phi = s * 2 * Math.PI / segs;
            pos.push(Math.cos(phi) * radius, y, Math.sin(phi) * radius);
            nrm.push(Math.cos(phi), 0, Math.sin(phi));
            uv.push(s / segs, 0.25 + r / rings * 0.5);
        }
    }
    for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segs; s++) {
            const a = baseRing + r * (segs + 1) + s;
            const b = a + segs + 1;
            idx.push(a, b, a+1, b, b+1, a+1);
        }
    }

    return {
        vertices: interleave(pos, nrm, uv),
        indices:  new Uint16Array(idx),
        name: 'Capsule',
    };
}

export function makePlane(subdivs = 10) {
    const pos = [], nrm = [], uv = [];
    const idx = [];
    for (let z = 0; z <= subdivs; z++) {
        for (let x = 0; x <= subdivs; x++) {
            const fx = x / subdivs - 0.5, fz = z / subdivs - 0.5;
            pos.push(fx * 10, 0, fz * 10);
            nrm.push(0, 1, 0);
            uv.push(x / subdivs, z / subdivs);
        }
    }
    const w = subdivs + 1;
    for (let z = 0; z < subdivs; z++) {
        for (let x = 0; x < subdivs; x++) {
            const a = z * w + x;
            idx.push(a, a + w, a + 1, a + w, a + w + 1, a + 1);
        }
    }
    return {
        vertices: interleave(pos, nrm, uv),
        indices:  new Uint16Array(idx),
        name: 'Plane',
    };
}

export function makeQuad() {
    const pos = [-0.5,  0.5, 0,  0.5,  0.5, 0,  0.5, -0.5, 0, -0.5, -0.5, 0];
    const nrm = [ 0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1];
    const uv  = [ 0, 1,  1, 1,  1, 0,  0, 0];
    return {
        vertices: interleave(pos, nrm, uv),
        indices:  new Uint16Array([0,2,1, 0,3,2]),
        name: 'Quad',
    };
}

export const PRIMITIVES = { Cube: makeCube, Sphere: makeSphere, Cylinder: makeCylinder, Capsule: makeCapsule, Plane: makePlane, Quad: makeQuad };
