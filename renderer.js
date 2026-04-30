import { PRIMITIVES } from './primitives.js';

const VS_PHONG = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_normalMat;
out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
void main() {
    vec4 wp   = u_model * vec4(a_pos, 1.0);
    v_worldPos= wp.xyz;
    v_normal  = normalize((u_normalMat * vec4(a_normal, 0.0)).xyz);
    v_uv      = a_uv;
    gl_Position = u_proj * u_view * wp;
}`;

const FS_PHONG = `#version 300 es
precision mediump float;
#define MAX_LIGHTS 8
in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
uniform vec3  u_camPos;
uniform vec4  u_albedo;
uniform float u_shininess;
uniform bool  u_useTex;
uniform sampler2D u_tex;
uniform int   u_lightCount;
uniform vec3  u_lightPos[MAX_LIGHTS];
uniform vec3  u_lightColor[MAX_LIGHTS];
uniform float u_lightIntensity[MAX_LIGHTS];
uniform int   u_lightType[MAX_LIGHTS];
out vec4 fragColor;
void main() {
    vec4  base    = u_useTex ? texture(u_tex, v_uv) : u_albedo;
    vec3  N       = normalize(v_normal);
    vec3  V       = normalize(u_camPos - v_worldPos);
    vec3  ambient = base.rgb * 0.13;
    vec3  diff    = vec3(0.0);
    vec3  spec    = vec3(0.0);
    for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= u_lightCount) break;
        vec3  L;
        float att = 1.0;
        if (u_lightType[i] == 1) {
            L = normalize(u_lightPos[i]);
        } else {
            vec3  toL = u_lightPos[i] - v_worldPos;
            float d   = length(toL);
            L         = toL / d;
            att       = 1.0 / (1.0 + 0.09*d + 0.032*d*d);
        }
        float NdL = max(dot(N,L), 0.0);
        vec3  H   = normalize(L + V);
        float sp  = pow(max(dot(N,H), 0.0), u_shininess);
        vec3  lc  = u_lightColor[i] * u_lightIntensity[i] * att;
        diff += lc * base.rgb * NdL;
        spec += lc * sp * 0.45;
    }
    fragColor = vec4(ambient + diff + spec, base.a);
}`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const e = gl.getShaderInfoLog(s); gl.deleteShader(s);
        throw new Error('Shader: ' + e);
    }
    return s;
}

function link(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const e = gl.getProgramInfoLog(p); gl.deleteProgram(p);
        throw new Error('Link: ' + e);
    }
    return p;
}

function mul4(a, b) {
    const o = new Float32Array(16);
    for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[r+k*4]*b[k+c*4];
            o[r+c*4] = s;
        }
    return o;
}

function identity() { const m=new Float32Array(16); m[0]=m[5]=m[10]=m[15]=1; return m; }

function perspective(fovY, aspect, near, far) {
    const f=1/Math.tan(fovY*0.5), nf=1/(near-far), o=new Float32Array(16);
    o[0]=f/aspect; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=2*far*near*nf;
    return o;
}

function lookAt(eye, at, up) {
    const f=norm3(sub3(at,eye)), s=norm3(cross3(f,up)), u=cross3(s,f), o=new Float32Array(16);
    o[0]=s[0]; o[4]=s[1]; o[8]=s[2];
    o[1]=u[0]; o[5]=u[1]; o[9]=u[2];
    o[2]=-f[0];o[6]=-f[1];o[10]=-f[2];
    o[12]=-(s[0]*eye[0]+s[1]*eye[1]+s[2]*eye[2]);
    o[13]=-(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]);
    o[14]= (f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2]);
    o[15]=1; return o;
}

function trs(pos, rot, scl) {
    const { x:qx=0, y:qy=0, z:qz=0, w:qw=1 } = rot ?? {};
    const { x:px=0, y:py=0, z:pz=0 }           = pos ?? {};
    const { x:sx=1, y:sy=1, z:sz=1 }           = scl ?? {};
    const x2=qx+qx, y2=qy+qy, z2=qz+qz;
    const xx=qx*x2, xy=qx*y2, xz=qx*z2, yy=qy*y2, yz=qy*z2, zz=qz*z2;
    const wx=qw*x2, wy=qw*y2, wz=qw*z2;
    return new Float32Array([
        (1-(yy+zz))*sx, (xy+wz)*sx,     (xz-wy)*sx,     0,
        (xy-wz)*sy,     (1-(xx+zz))*sy, (yz+wx)*sy,     0,
        (xz+wy)*sz,     (yz-wx)*sz,     (1-(xx+yy))*sz, 0,
        px, py, pz, 1,
    ]);
}

function normalMat(m) {
    const o=new Float32Array(16);
    const a00=m[0],a01=m[1],a02=m[2],a10=m[4],a11=m[5],a12=m[6],a20=m[8],a21=m[9],a22=m[10];
    const b01=a22*a11-a12*a21, b11=-a22*a10+a12*a20, b21=a21*a10-a11*a20;
    let det=a00*b01+a01*b11+a02*b21;
    if (Math.abs(det)<1e-8){o[0]=o[5]=o[10]=o[15]=1;return o;}
    det=1/det;
    o[0]=b01*det;  o[1]=(-a22*a01+a02*a21)*det; o[2]=(a12*a01-a02*a11)*det;
    o[4]=b11*det;  o[5]=(a22*a00-a02*a20)*det;  o[6]=(-a12*a00+a02*a10)*det;
    o[8]=b21*det;  o[9]=(-a21*a00+a01*a20)*det; o[10]=(a11*a00-a01*a10)*det;
    o[15]=1; return o;
}

function sub3(a,b)   { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function dot3(a,b)   { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross3(a,b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function norm3(v)    { const l=Math.sqrt(dot3(v,v)); return l>1e-8?[v[0]/l,v[1]/l,v[2]/l]:[0,1,0]; }
function ul(gl,p,n)  { return gl.getUniformLocation(p,n); }

function uploadMeshData(gl, interleaved, indices) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
    const stride = 8*4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,stride,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,stride,12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,2,gl.FLOAT,false,stride,24);
    let ebo=null, drawCount=interleaved.length/8;
    if (indices) {
        ebo=gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
        drawCount=indices.length;
    }
    gl.bindVertexArray(null);
    return { vao, ebo, drawCount };
}

function decodeVertexData(vd) {
    const vertCount = vd.m_VertexCount ?? vd.VertexCount;
    if (!vertCount) return null;
    const dataSrc   = vd.m_DataSize ?? vd.DataSize ?? vd.m_Data ?? vd.Data;
    const rawBytes  = dataSrc?.raw instanceof Uint8Array ? dataSrc.raw : null;
    if (!rawBytes) return null;
    const dv        = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const channels  = vd.m_Channels ?? vd.Channels ?? [];
    const streams   = vd.m_Streams  ?? vd.Streams  ?? [];

    function readCh(chIdx, defaultDim) {
        if (chIdx >= channels.length) return null;
        const ch   = channels[chIdx];
        const strm = ch.stream ?? ch.Stream ?? 0;
        const off  = ch.offset ?? ch.Offset ?? 0;
        const fmt  = ch.format ?? ch.Format ?? 0;
        const dim  = ch.dimension ?? ch.Dimension ?? defaultDim;
        let stride = dim*4, strmOff=0;
        if (strm < streams.length) {
            stride  = streams[strm].stride  ?? streams[strm].Stride  ?? stride;
            strmOff = streams[strm].offset  ?? streams[strm].Offset  ?? 0;
        }
        const out = new Float32Array(vertCount*dim);
        for (let v=0;v<vertCount;v++) {
            const base = strmOff + v*stride + off;
            for (let d=0;d<dim;d++) {
                if (fmt===0)       out[v*dim+d] = dv.getFloat32(base+d*4, true);
                else if (fmt===11) out[v*dim+d] = dv.getInt8(base+d) / 127.0;
                else               out[v*dim+d] = dv.getUint16(base+d*2,true) / 65535.0;
            }
        }
        return out;
    }

    const positions = readCh(0,3);
    if (!positions) return null;
    const normals   = readCh(1,3);
    const uvs       = readCh(channels.length > 4 ? 4 : 3, 2);
    return { positions, normals, uvs, vertCount };
}

function buildInterleaved(positions, normals, uvs, vertCount) {
    const out = new Float32Array(vertCount*8);
    for (let i=0;i<vertCount;i++) {
        out[i*8+0]=positions[i*3+0]; out[i*8+1]=positions[i*3+1]; out[i*8+2]=positions[i*3+2];
        out[i*8+3]=normals  ?normals[i*3+0]:0;
        out[i*8+4]=normals  ?normals[i*3+1]:1;
        out[i*8+5]=normals  ?normals[i*3+2]:0;
        out[i*8+6]=uvs      ?uvs[i*2+0]   :0;
        out[i*8+7]=uvs      ?uvs[i*2+1]   :0;
    }
    return out;
}

const DEFAULT_LIGHTS = [
    { pos:[5,8,6],    color:[1.0,0.95,0.90], intensity:1.2, type:1 },
    { pos:[-4,3,-5],  color:[0.40,0.50,0.80], intensity:0.5, type:1 },
];

export class UWPjsRenderer {
    constructor(canvasId='game-canvas') {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            this.canvas        = document.createElement('canvas');
            this.canvas.id     = canvasId;
            this.canvas.width  = 960;
            this.canvas.height = 480;
            (document.getElementById('game-container') ?? document.body).appendChild(this.canvas);
        }

        this._overlayCanvas        = document.createElement('canvas');
        this._overlayCanvas.width  = this.canvas.width;
        this._overlayCanvas.height = this.canvas.height;
        this._overlayCanvas.style.cssText =
            'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
        const wrap = this.canvas.parentElement;
        if (wrap && getComputedStyle(wrap).position==='static') wrap.style.position='relative';
        if (wrap) wrap.appendChild(this._overlayCanvas);

        this.gl = this.canvas.getContext('webgl2');
        if (!this.gl) { console.warn('[Renderer] WebGL2 unavailable'); return; }

        const gl=this.gl;
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);  gl.cullFace(gl.BACK);

        this._prog           = link(gl, compile(gl,gl.VERTEX_SHADER,VS_PHONG), compile(gl,gl.FRAGMENT_SHADER,FS_PHONG));
        this._primVAOs       = new Map();
        this._uploadedMeshes = [];
        this._textures       = new Map();
        this._sceneNodes     = [];
        this._lights         = DEFAULT_LIGHTS.slice();
        this._camera         = null;
        this._sceneInfo      = null;
        this._angle          = 0;

        for (const [name, fn] of Object.entries(PRIMITIVES)) {
            const prim = fn();
            this._primVAOs.set(name, { ...uploadMeshData(gl, prim.vertices, prim.indices), name });
        }
        console.log('[Renderer] Ready — primitives:', [...this._primVAOs.keys()].join(', '));
    }

    loadMeshes(sfObjects) {
        const gl=this.gl; if (!gl) return;
        this._uploadedMeshes=[];
        for (const m of (sfObjects??[]).filter(o=>o.classID===43&&o.meshData)) {
            const vd=decodeVertexData(m.meshData?.m_VertexData ?? m.meshData?.VertexData ?? m.meshData);
            if (!vd) continue;
            const interleaved = buildInterleaved(vd.positions,vd.normals,vd.uvs,vd.vertCount);
            const ir=m.meshData.m_IndexBuffer ?? m.meshData.m_Indices;
            let indices=null;
            if (ir?.raw instanceof Uint8Array) {
                const r=ir.raw;
                indices=r.byteLength%4===0
                    ?new Uint32Array(r.buffer,r.byteOffset,r.byteLength>>2)
                    :new Uint16Array(r.buffer,r.byteOffset,r.byteLength>>1);
            }
            const mesh={...uploadMeshData(gl,interleaved,indices), name:m.name};
            this._uploadedMeshes.push(mesh);
            console.log(`[Renderer] Mesh "${m.name}" — ${vd.vertCount} verts`);
        }
    }

    loadTexture(name, imageData, width, height) {
        const gl=this.gl; if (!gl) return null;
        const tex=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,imageData);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        this._textures.set(name,tex); return tex;
    }

    setSceneNodes(nodes) { this._sceneNodes = nodes ?? []; }
    setCamera(cam)       { this._camera = cam; }
    setLights(lights)    { this._lights = lights?.length ? lights : DEFAULT_LIGHTS.slice(); }

    setSceneInfo(info) {
        this._sceneInfo = info;
        if (info?.lights?.length) this.setLights(info.lights);
        if (info?.camera)         this.setCamera(info.camera);
    }

    _resolveVAO(node) {
        if (node.meshName && this._primVAOs.has(node.meshName)) return this._primVAOs.get(node.meshName);
        if (node.meshName) return this._uploadedMeshes.find(m=>m.name===node.meshName) ?? null;
        return null;
    }

    _buildCamera() {
        const W=this.canvas.width, H=this.canvas.height, aspect=W/H;
        if (this._camera) {
            const cam = this._camera;
            const eye = [cam.position?.x??0, cam.position?.y??1, cam.position?.z??-10];
            const fwd = cam.forward ?? [0,0,1];
            const at  = [eye[0]+fwd[0], eye[1]+fwd[1], eye[2]+fwd[2]];
            return {
                proj: perspective((cam.fieldOfView??60)*Math.PI/180, aspect, cam.nearClip??0.1, cam.farClip??1000),
                view: lookAt(eye,at,[0,1,0]),
                eye,
            };
        }
        this._angle += 0.004;
        const eye=[Math.sin(this._angle)*7, 3.5, Math.cos(this._angle)*7];
        return {
            proj: perspective(Math.PI/3.5, aspect, 0.1, 1000),
            view: lookAt(eye,[0,0.5,0],[0,1,0]),
            eye,
        };
    }

    _applyLights(prog) {
        const gl=this.gl, lights=this._lights, n=Math.min(lights.length,8);
        gl.uniform1i(ul(gl,prog,'u_lightCount'), n);
        for (let i=0;i<n;i++) {
            const l=lights[i];
            const p=Array.isArray(l.pos)?l.pos:[l.x??0,l.y??8,l.z??0];
            gl.uniform3fv(ul(gl,prog,`u_lightPos[${i}]`),      new Float32Array(p));
            gl.uniform3fv(ul(gl,prog,`u_lightColor[${i}]`),    new Float32Array(l.color??[1,1,1]));
            gl.uniform1f (ul(gl,prog,`u_lightIntensity[${i}]`),l.intensity??1);
            gl.uniform1i (ul(gl,prog,`u_lightType[${i}]`),     l.type??0);
        }
    }

    _drawNode(node, prog, cam) {
        const gl=this.gl;
        const vao=this._resolveVAO(node); if (!vao) return;
        const model=trs(node.localPosition,node.localRotation,node.localScale);
        const nmat =normalMat(model);
        const col  =node.color??[0.72,0.72,0.72,1.0];
        gl.uniformMatrix4fv(ul(gl,prog,'u_model'),    false,model);
        gl.uniformMatrix4fv(ul(gl,prog,'u_view'),     false,cam.view);
        gl.uniformMatrix4fv(ul(gl,prog,'u_proj'),     false,cam.proj);
        gl.uniformMatrix4fv(ul(gl,prog,'u_normalMat'),false,nmat);
        gl.uniform3fv(ul(gl,prog,'u_camPos'), new Float32Array(cam.eye));
        gl.uniform4fv(ul(gl,prog,'u_albedo'), new Float32Array(col));
        gl.uniform1f (ul(gl,prog,'u_shininess'), node.shininess??48);
        const tex=node.texName?this._textures.get(node.texName):null;
        gl.uniform1i(ul(gl,prog,'u_useTex'), tex?1:0);
        if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,tex); gl.uniform1i(ul(gl,prog,'u_tex'),0); }
        gl.bindVertexArray(vao.vao);
        if (vao.ebo) gl.drawElements(gl.TRIANGLES,vao.drawCount,gl.UNSIGNED_SHORT,0);
        else         gl.drawArrays(gl.TRIANGLES,0,vao.drawCount);
        gl.bindVertexArray(null);
    }

    renderFrame() {
        const gl=this.gl; if (!gl) return;
        const W=this.canvas.width, H=this.canvas.height;
        gl.viewport(0,0,W,H);
        const info=this._sceneInfo;
        const bg=info?.backgroundColor??[0.08,0.10,0.15];
        gl.clearColor(bg[0],bg[1],bg[2],1);
        gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

        const hasContent=this._sceneNodes.length>0||this._uploadedMeshes.length>0;
        if (!hasContent) { this._drawInfoOverlay(); return; }

        const cam=this._buildCamera();
        const prog=this._prog;
        gl.useProgram(prog);
        this._applyLights(prog);

        if (this._sceneNodes.length>0) {
            for (const node of this._sceneNodes) {
                if (node.isActive===0) continue;
                this._drawNode(node,prog,cam);
            }
        } else {
            for (const mesh of this._uploadedMeshes) {
                const model=identity();
                gl.uniformMatrix4fv(ul(gl,prog,'u_model'),    false,model);
                gl.uniformMatrix4fv(ul(gl,prog,'u_view'),     false,cam.view);
                gl.uniformMatrix4fv(ul(gl,prog,'u_proj'),     false,cam.proj);
                gl.uniformMatrix4fv(ul(gl,prog,'u_normalMat'),false,identity());
                gl.uniform3fv(ul(gl,prog,'u_camPos'), new Float32Array(cam.eye));
                gl.uniform4fv(ul(gl,prog,'u_albedo'), new Float32Array([0.7,0.7,0.7,1]));
                gl.uniform1f (ul(gl,prog,'u_shininess'), 48);
                gl.uniform1i (ul(gl,prog,'u_useTex'), 0);
                gl.bindVertexArray(mesh.vao);
                if (mesh.ebo) gl.drawElements(gl.TRIANGLES,mesh.drawCount,gl.UNSIGNED_SHORT,0);
                else          gl.drawArrays(gl.TRIANGLES,0,mesh.drawCount);
                gl.bindVertexArray(null);
            }
        }
    }

    _drawInfoOverlay() {
        const canvas=this._overlayCanvas; if (!canvas) return;
        const ctx=canvas.getContext('2d'); if (!ctx) return;
        const W=canvas.width, H=canvas.height;
        ctx.clearRect(0,0,W,H);
        ctx.fillStyle='#0d0d14'; ctx.fillRect(0,0,W,H);
        const cx=W/2, cy=H/2;
        ctx.strokeStyle='#1a2535'; ctx.lineWidth=1;
        for (let x=40;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
        for (let y=40;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
        ctx.strokeStyle='#253a55'; ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(cx,0);ctx.lineTo(cx,H);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0,cy);ctx.lineTo(W,cy);ctx.stroke();
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='#3a6090'; ctx.font='bold 13px monospace';
        ctx.fillText('RUNTIME GEOMETRY — NO STORED MESHES',cx,cy-56);
        ctx.fillStyle='#7aa8cc'; ctx.font='11px monospace';
        ctx.fillText('This game generates all geometry at runtime via C# scripts.',cx,cy-34);
        ctx.fillText('Rendering requires MonoBehaviour execution — not yet implemented.',cx,cy-16);
        const info=this._sceneInfo;
        if (info) {
            ctx.fillStyle='#4a7fa8'; ctx.font='11px monospace';
            ctx.fillText([`${info.gameObjects??0} GameObjects`,`${info.cameras??0} Cameras`,
                `${info.lights??0} Lights`,`${info.monoBehaviours??0} MonoBehaviours`].join('  •  '),cx,cy+10);
            if (info.assemblies?.length) {
                ctx.fillStyle='#305570'; ctx.font='10px monospace';
                ctx.fillText(info.assemblies.slice(0,5).join('   '),cx,cy+28);
            }
        }
        ctx.fillStyle='#203040'; ctx.font='10px monospace';
        ctx.fillText('UWP.js  —  Unity Web Player Emulator',cx,H-14);
    }
}
