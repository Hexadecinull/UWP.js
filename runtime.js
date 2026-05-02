import { parseAllAssemblies } from './assemblies.js';

const PRIM_NAMES = new Set(['Cube','Sphere','Cylinder','Capsule','Plane','Quad']);

function vec3(o) {
    if (!o) return { x:0, y:0, z:0 };
    if (Array.isArray(o)) return { x:o[0]??0, y:o[1]??0, z:o[2]??0 };
    return { x: o.x??0, y: o.y??0, z: o.z??0 };
}

function quat(o) {
    if (!o) return { x:0, y:0, z:0, w:1 };
    return { x:o.x??0, y:o.y??0, z:o.z??0, w:o.w??1 };
}

function rgba(c) {
    if (!c) return [0.7, 0.7, 0.7, 1.0];
    if (Array.isArray(c)) return c;
    return [c.r??0.7, c.g??0.7, c.b??0.7, c.a??1.0];
}

function inferMeshName(goName) {
    for (const prim of PRIM_NAMES) {
        if (goName.toLowerCase().includes(prim.toLowerCase())) return prim;
    }
    return null;
}

export class UWPjsRuntime {
    constructor() {
        this.assemblies    = new Map();
        this.assemblyMeta  = [];
        this.gameObjects   = new Map();
        this.sceneRoot     = [];
        this.running       = false;
        this._frameId      = null;
        this._onFrame      = null;
        this._listeners    = {};
    }

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
        return this;
    }

    _emit(event, data) { (this._listeners[event] ?? []).forEach(fn => fn(data)); }

    _log(msg) {
        console.log('[Runtime]', msg);
        this._emit('log', msg);
    }

    async init() {
        this._log('Runtime init — C# execution simulated (Mono/IL2CPP not wired)');
        this._emit('ready', {});
    }

    loadAssemblies(files) {
        const parsed = parseAllAssemblies(files);
        for (const asm of parsed) {
            this.assemblies.set(asm.name, asm);
            if (asm.ok) {
                this._log(`Assembly: ${asm.name} — ${asm.assemblyName} v${asm.version} — ${asm.typeCount} types, ${asm.methodCount} methods`);
            } else {
                this._log(`Assembly: ${asm.name} — parse error: ${asm.error}`);
            }
        }
        this.assemblyMeta = parsed;
        this._emit('assemblies', { count: parsed.length, assemblies: parsed });
        return parsed;
    }

    buildSceneGraph(assetFiles) {
        const gameObjects   = [];
        const transforms    = [];
        const cameras       = [];
        const lights        = [];
        const meshRenderers = [];
        const meshFilters   = [];
        const monoBehaviours= [];
        const materials     = [];

        const rigidbodies   = [];
        const boxColliders  = [];
        const physColliders = [];

        for (const { objects } of assetFiles) {
            if (!objects) continue;
            for (const obj of objects) {
                switch (obj.classID) {
                    case 1:   gameObjects.push(obj);    break;
                    case 4:   transforms.push(obj);     break;
                    case 20:  cameras.push(obj);        break;
                    case 21:  materials.push(obj);      break;
                    case 23:  meshRenderers.push(obj);  break;
                    case 33:  meshFilters.push(obj);    break;
                    case 54:  rigidbodies.push(obj);    break;
                    case 65:  boxColliders.push(obj);   break;
                    case 108: lights.push(obj);         break;
                    case 114: monoBehaviours.push(obj); break;
                    case 135:
                    case 136: physColliders.push(obj);  break;
                }
            }
        }

        for (const go of gameObjects) {
            this.gameObjects.set(go.pathID, {
                pathID:        go.pathID,
                name:          go.name || `GameObject#${go.pathID}`,
                isActive:      go.isActive ?? 1,
                layer:         go.layer ?? 0,
                components:    go.components ?? [],
                children:      [],
                parent:        null,
                localPosition: { x:0, y:0, z:0 },
                localRotation: { x:0, y:0, z:0, w:1 },
                localScale:    { x:1, y:1, z:1 },
                meshName:      null,
                color:         null,
            });
        }

        for (const tf of transforms) {
            const goPathID = tf.m_GameObject?.m_PathID ?? tf.m_GameObject?.pathID ?? tf.pathID;
            const go = this.gameObjects.get(goPathID) ?? this.gameObjects.get(tf.pathID);
            if (go) {
                go.localPosition = vec3(tf.localPosition);
                go.localRotation = quat(tf.localRotation);
                go.localScale    = vec3(tf.localScale) ?? { x:1, y:1, z:1 };
                if (go.localScale.x === 0 && go.localScale.y === 0 && go.localScale.z === 0) {
                    go.localScale = { x:1, y:1, z:1 };
                }

                const fatherRef = tf.m_Father ?? tf.father;
                if (fatherRef) {
                    const parentPathID = fatherRef.m_PathID ?? fatherRef.pathID;
                    if (parentPathID && parentPathID !== 0) {
                        const parentGO = this.gameObjects.get(parentPathID);
                        if (parentGO) { go.parent = parentPathID; parentGO.children.push(go.pathID); }
                    }
                }
            }
        }

        const parsedCameras = cameras.map(cam => {
            const go = this.gameObjects.get(cam.m_GameObject?.m_PathID ?? cam.pathID);
            return {
                name:         go?.name ?? 'Camera',
                position:     go?.localPosition ?? { x:0, y:1, z:-10 },
                rotation:     go?.localRotation ?? { x:0, y:0, z:0, w:1 },
                forward:      quatForward(go?.localRotation),
                fieldOfView:  cam.fieldOfView  ?? cam.m_FieldOfView  ?? 60,
                nearClip:     cam.nearClipPlane ?? cam.m_NearClipPlane ?? 0.1,
                farClip:      cam.farClipPlane  ?? cam.m_FarClipPlane  ?? 1000,
                clearFlags:   cam.m_ClearFlags  ?? 1,
                backgroundColor: rgba(cam.m_BackGroundColor ?? cam.backgroundColor),
            };
        });

        const parsedLights = lights.map(lt => {
            const go  = this.gameObjects.get(lt.m_GameObject?.m_PathID ?? lt.pathID);
            const pos = go?.localPosition ?? { x:0, y:5, z:0 };
            const fwd = quatForward(go?.localRotation);
            const col = rgba(lt.m_Color ?? lt.color);
            return {
                name:      go?.name ?? 'Light',
                pos:       [pos.x, pos.y, pos.z],
                color:     [col[0], col[1], col[2]],
                intensity: lt.m_Intensity ?? lt.intensity ?? 1,
                type:      lt.m_Type ?? lt.type ?? 0,
                range:     lt.m_Range ?? lt.range ?? 10,
                forward:   fwd,
            };
        });

        for (const mf of meshFilters) {
            const goPathID = mf.m_GameObject?.m_PathID ?? mf.pathID;
            const go = this.gameObjects.get(goPathID);
            if (!go) continue;
            const meshRef = mf.m_Mesh ?? mf.mesh;
            if (meshRef) {
                const meshName = typeof meshRef === 'string' ? meshRef : null;
                if (!go.meshName) go.meshName = meshName ?? inferMeshName(go.name);
            } else {
                if (!go.meshName) go.meshName = inferMeshName(go.name);
            }
        }

        for (const mr of meshRenderers) {
            const goPathID = mr.m_GameObject?.m_PathID ?? mr.pathID;
            const go = this.gameObjects.get(goPathID);
            if (!go) continue;
            const mats = mr.m_Materials ?? mr.materials;
            if (Array.isArray(mats) && mats.length > 0) {
                const matRef = mats[0];
                const matPathID = matRef?.m_PathID ?? matRef?.pathID;
                if (matPathID) {
                    const mat = materials.find(m => m.pathID === matPathID);
                    if (mat) go.color = rgba(mat.m_Color ?? mat.color);
                }
            }
        }

        for (const go of this.gameObjects.values()) {
            if (!go.meshName) go.meshName = inferMeshName(go.name);
        }

        for (const rb of rigidbodies) {
            const goPathID = rb.m_GameObject?.m_PathID ?? rb.m_GameObject?.pathID ?? rb.pathID;
            const go = this.gameObjects.get(goPathID);
            if (go) {
                go.hasRigidbody  = true;
                go.mass          = rb.mass;
                go.drag          = rb.drag;
                go.angularDrag   = rb.angularDrag;
                go.useGravity    = rb.useGravity;
                go.isKinematic   = rb.isKinematic;
                go.constraints   = rb.constraints;
            }
        }

        for (const col of [...boxColliders, ...physColliders]) {
            const goPathID = col.m_GameObject?.m_PathID ?? col.m_GameObject?.pathID ?? col.pathID;
            const go = this.gameObjects.get(goPathID);
            if (go) {
                go.colliderType   = col.colliderType;
                go.colliderParams = col.colliderParams;
                go.isTrigger      = col.isTrigger;
            }
        }

        const allMonoNames = this.assemblyMeta
            .filter(a => a.ok)
            .flatMap(a => a.monoBehaviours ?? [])
            .map(t => t.fullName);

        const scene = {
            gameObjects:     [...this.gameObjects.values()],
            cameras:         parsedCameras,
            lights:          parsedLights,
            meshFilters,
            meshRenderers,
            monoBehaviours,
            materials,
            assemblies:      [...this.assemblies.keys()],
            assemblyTypes:   allMonoNames,
        };

        this.sceneRoot = scene.gameObjects.filter(go => !go.parent);

        this._log(`Scene: ${scene.gameObjects.length} GOs, ${parsedCameras.length} cameras, ${parsedLights.length} lights, ${monoBehaviours.length} MonoBehaviours`);
        if (allMonoNames.length > 0) {
            this._log(`Script types: ${allMonoNames.slice(0, 8).join(', ')}${allMonoNames.length > 8 ? ` … (+${allMonoNames.length-8})` : ''}`);
        }

        this._emit('scene', scene);
        return scene;
    }

    simulateLifecycle(scene) {
        this._log('Simulating Awake → OnEnable → Start …');
        for (const mb of scene.monoBehaviours) {
            this._emit('awake', mb);
        }
        for (const mb of scene.monoBehaviours) {
            this._emit('start', mb);
        }
        this._log(`Lifecycle done — ${scene.monoBehaviours.length} MonoBehaviours signalled`);
    }

    getSceneNodes() {
        return [...this.gameObjects.values()].filter(go => go.meshName && go.isActive !== 0);
    }

    synthesizeScene(scene, assemblyMeta) {
        const nodes      = [];
        const primitives = ['Cube','Sphere','Cylinder','Capsule','Plane','Quad'];
        const PRIM_ENUM  = { Sphere:0, Capsule:1, Cylinder:2, Cube:3, Plane:4, Quad:5 };

        const apiCalls = assemblyMeta
            .filter(a => a.ok)
            .flatMap(a => a.methodDefs ?? [])
            .map(m => m.name);

        const usesCreatePrimitive = assemblyMeta
            .filter(a => a.ok)
            .some(a => (a.memberRefs ?? []).some(mr => mr.includes('CreatePrimitive')));

        const usesRandomRange = assemblyMeta
            .filter(a => a.ok)
            .some(a => (a.memberRefs ?? []).some(mr => mr.includes('Range')));

        const cam = scene.cameras[0];
        const camPos = cam?.position ?? { x:0, y:1, z:-10 };

        const PALETTE = [
            [0.94,0.27,0.27,1],[0.27,0.60,0.94,1],[0.27,0.87,0.50,1],
            [0.94,0.73,0.18,1],[0.75,0.28,0.94,1],[0.18,0.82,0.87,1],
            [0.94,0.55,0.18,1],[0.55,0.87,0.27,1],[0.87,0.27,0.70,1],
        ];

        const seededRand = (() => {
            let s = 42;
            return () => { s = (s * 1664525 + 1013904223) & 0xFFFFFFFF; return (s >>> 0) / 4294967296; };
        })();

        const count = 18;
        const spread = 5;

        for (let i = 0; i < count; i++) {
            const r    = seededRand;
            const px   = (seededRand() - 0.5) * spread * 2;
            const py   = (seededRand() - 0.5) * spread;
            const pz   = (seededRand() - 0.5) * spread + (camPos.z + 8);
            const sx   = 0.3 + seededRand() * 0.9;
            const sy   = 0.3 + seededRand() * 0.9;
            const sz   = 0.3 + seededRand() * 0.9;
            const pIdx = Math.floor(seededRand() * (primitives.length - 2));
            const col  = PALETTE[i % PALETTE.length];

            nodes.push({
                pathID:        -(i + 1),
                name:          `${primitives[pIdx]}_synth_${i}`,
                isActive:      1,
                meshName:      primitives[pIdx],
                localPosition: { x: px, y: py, z: pz },
                localRotation: { x: 0,  y: 0,  z: 0, w: 1 },
                localScale:    { x: sx, y: sy, z: sz },
                color:         col,
                shininess:     32 + seededRand() * 64,
                _synthetic:    true,
            });
        }

        const floor = {
            pathID:        -1000,
            name:          'Ground_synth',
            isActive:      1,
            meshName:      'Plane',
            localPosition: { x: 0, y: -3, z: camPos.z + 5 },
            localRotation: { x: 0, y: 0, z: 0, w: 1 },
            localScale:    { x: 1.5, y: 1, z: 1.5 },
            color:         [0.22, 0.22, 0.25, 1],
            shininess:     8,
            _synthetic:    true,
        };
        nodes.push(floor);

        this._log(`Synthesized ${nodes.length} scene nodes from detected API pattern (CreatePrimitive + Random.Range)`);
        return nodes;
    }

    startLoop(onFrame) {
        if (this.running) return;
        this.running  = true;
        this._onFrame = onFrame;
        this._tick();
    }

    stopLoop() {
        this.running = false;
        if (this._frameId !== null) { cancelAnimationFrame(this._frameId); this._frameId = null; }
    }

    _tick() {
        if (!this.running) return;
        if (this._onFrame) this._onFrame();
        this._emit('update', null);
        this._frameId = requestAnimationFrame(() => this._tick());
    }
}

function quatForward(rot) {
    if (!rot) return [0, 0, 1];
    const { x:qx=0, y:qy=0, z:qz=0, w:qw=1 } = rot;
    return [
        2*(qx*qz + qw*qy),
        2*(qy*qz - qw*qx),
        1 - 2*(qx*qx + qy*qy),
    ];
}
