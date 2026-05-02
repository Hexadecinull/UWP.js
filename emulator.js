import { UWPjsParser }         from './parser.js';
import { UWPjsRuntime }        from './runtime.js';
import { UWPjsRenderer }       from './renderer.js';
import { UWPjsAudio }          from './audio.js';
import { UWPjsPhysics }        from './physics.js';
import { UWPjsInput }          from './input.js';
import { parseSerializedFile }  from './serializedf.js';
import { decodeTexture2D }      from './textures.js';

function eulerToQuat(rx, ry, rz) {
    const cx = Math.cos(rx * 0.5), sx = Math.sin(rx * 0.5);
    const cy = Math.cos(ry * 0.5), sy = Math.sin(ry * 0.5);
    const cz = Math.cos(rz * 0.5), sz = Math.sin(rz * 0.5);
    return {
        x: sx*cy*cz + cx*sy*sz,
        y: cx*sy*cz - sx*cy*sz,
        z: cx*cy*sz + sx*sy*cz,
        w: cx*cy*cz - sx*sy*sz,
    };
}

export class UWPjs {
    constructor(buffer, opts = {}) {
        this.buffer   = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
        this.opts     = opts;
        this.parser   = new UWPjsParser(this.buffer);
        this.runtime  = new UWPjsRuntime();
        this.renderer = new UWPjsRenderer(opts.canvasId ?? 'game-canvas');
        this.audio    = new UWPjsAudio();
        this.physics  = new UWPjsPhysics();
        this.input    = new UWPjsInput(document.getElementById(opts.canvasId ?? 'game-canvas') ?? window);
        this._log     = opts.onLog ?? (msg => console.log('[UWPjs]', msg));
        this._prevTime= performance.now();

        this.runtime.on('log', msg => this._log(msg));
    }

    async start() {
        this._log('Parsing bundle …');
        const parsed = this.parser.parse();
        if (!parsed.ok) { this._log(`Bundle parse failed: ${parsed.error}`); return { ok: false, error: parsed.error }; }
        this._log(`Format: ${parsed.bundleKind} — ${parsed.headerStr}`);

        const files  = parsed.files ?? [];
        const sfList = [];

        for (const f of files) {
            if (f.name.endsWith('.dll') || f.name.endsWith('.mdb') || f.name.endsWith('.pdb')) continue;
            let sf;
            try { sf = parseSerializedFile(f.buffer, f.name); }
            catch (e) { this._log(`  Parse error (${f.name}): ${e.message}`); continue; }
            if (!sf.ok) { this._log(`  ${f.name}: ${sf.error}`); continue; }
            this._log(`  ${f.name}: SF v${sf.version} / Unity ${sf.unityVersion} — ${sf.objectCount} objects`);
            sfList.push(sf);
        }

        await this.runtime.init();
        this.runtime.loadAssemblies(files);

        const scene      = this.runtime.buildSceneGraph(sfList);
        const allObjects = sfList.flatMap(sf => sf.objects);

        await this.audio.loadAll(allObjects);
        if (this.audio.clips.length > 0) {
            this._log(`Audio: ${this.audio.clips.length} clips — ${this.audio.clips.slice(0,4).join(', ')}${this.audio.clips.length>4?' …':''}`);
        }

        await this._uploadTextures(allObjects);

        this._applyMaterialsToNodes(scene, allObjects);

        this.runtime.simulateLifecycle(scene);
        this.renderer.loadMeshes(allObjects);

        let sceneNodes = this.runtime.getSceneNodes();

        if (sceneNodes.length === 0) {
            sceneNodes = this.runtime.synthesizeScene(scene, this.runtime.assemblyMeta);
            this._log(`Using synthesized scene (${sceneNodes.length} nodes) — no stored mesh objects found`);
        }

        this.renderer.setSceneNodes(sceneNodes);

        if (sceneNodes.length > 0) {
            const names = sceneNodes.map(n => `${n.name}(${n.meshName})`).slice(0, 6).join(', ');
            this._log(`Render nodes: ${sceneNodes.length} — ${names}${sceneNodes.length > 6 ? ' …' : ''}`);
        }

        this.physics.buildFromScene(sceneNodes);

        const activeCam = scene.cameras[0] ?? null;
        if (activeCam) {
            this.renderer.setCamera(activeCam);
            this._log(`Camera: "${activeCam.name}" fov=${activeCam.fieldOfView}° near=${activeCam.nearClip} far=${activeCam.farClip}`);
        }

        if (scene.lights.length > 0) {
            this.renderer.setLights(scene.lights);
            this._log(`Lights: ${scene.lights.length} — ${scene.lights.map(l => l.name).join(', ')}`);
        }

        this.renderer.setSceneInfo({
            gameObjects:     scene.gameObjects.length,
            cameras:         scene.cameras.length,
            lights:          scene.lights.length,
            monoBehaviours:  scene.monoBehaviours.length,
            assemblies:      scene.assemblies,
            backgroundColor: activeCam?.backgroundColor?.slice(0, 3) ?? [0.08, 0.10, 0.15],
            camera:          activeCam,
            lightsArr:       scene.lights,
        });

        this._prevTime = performance.now();
        this.runtime.startLoop(() => this._frame());
        this._log('Game loop started.');

        return { ok: true, scene, sfCount: sfList.length };
    }

    _frame() {
        const now = performance.now();
        const dt  = Math.min((now - this._prevTime) / 1000, 0.05);
        this._prevTime = now;
        this._elapsed  = (this._elapsed ?? 0) + dt;

        this.input.update(dt);
        this.physics.step(dt);
        this._animateSynthetic(this._elapsed);
        this.renderer.renderFrame();
        this.input.lateUpdate();
    }

    _animateSynthetic(t) {
        const nodes = this.renderer._sceneNodes;
        if (!nodes?.length) return;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n._synthetic) continue;
            const phase = i * 0.53;
            n.localPosition.y += Math.sin(t * 0.8 + phase) * 0.003;
            n.localRotation = eulerToQuat(
                t * 0.3 * (i % 3 === 0 ? 1 : -0.7) + phase,
                t * 0.5 * (i % 2 === 0 ? 1 : -0.5) + phase * 1.3,
                0
            );
        }
    }

    async _uploadTextures(allObjects) {
        const textures = allObjects.filter(o => o.classID === 28 && o.imageData && o.width > 0 && o.height > 0);
        if (!textures.length) return;
        this._log(`Uploading ${textures.length} texture${textures.length !== 1 ? 's' : ''} to GPU …`);

        for (const tex of textures) {
            try {
                const blob    = await decodeTexture2D(tex.imageData, tex.width, tex.height, tex.textureFormat);
                if (!blob) continue;
                const bitmap  = await createImageBitmap(blob);
                const canvas  = new OffscreenCanvas(tex.width, tex.height);
                const ctx2d   = canvas.getContext('2d');
                ctx2d.drawImage(bitmap, 0, 0);
                const id      = ctx2d.getImageData(0, 0, tex.width, tex.height);
                this.renderer.loadTexture(tex.name, id.data, tex.width, tex.height);
                bitmap.close();
                this._log(`  Texture "${tex.name}" ${tex.width}×${tex.height} ${tex.formatName} → GPU`);
            } catch (e) {
                this._log(`  Texture "${tex.name}" upload failed: ${e.message}`);
            }
        }
    }

    _applyMaterialsToNodes(scene, allObjects) {
        const matsByPathID = new Map(allObjects.filter(o => o.classID === 21).map(m => [m.pathID, m]));
        const mrByGoPathID = new Map(allObjects.filter(o => o.classID === 23).map(mr => [mr.m_GameObject?.m_PathID ?? mr.pathID, mr]));

        for (const go of scene.gameObjects) {
            const mr = mrByGoPathID.get(go.pathID);
            if (!mr) continue;
            const mats = mr.m_Materials ?? [];
            const firstMatRef = Array.isArray(mats) ? mats[0] : null;
            if (!firstMatRef) continue;
            const matPathID = firstMatRef?.m_PathID ?? firstMatRef?.pathID;
            if (!matPathID) continue;
            const mat = matsByPathID.get(matPathID);
            if (!mat) continue;

            if (!go.color && mat.color) go.color = mat.color;
            if (!go.shininess && mat.shininess) go.shininess = mat.shininess;

            if (mat.mainTex?.texRef) {
                const texPathID = mat.mainTex.texRef?.m_PathID ?? mat.mainTex.texRef?.pathID;
                if (texPathID) {
                    const texAsset = allObjects.find(o => o.classID === 28 && o.pathID === texPathID);
                    if (texAsset?.name) go.texName = texAsset.name;
                }
            }
        }
    }

    stop() {
        this.runtime.stopLoop();
        this.audio.stopAll();
        this._log('Stopped.');
    }

    playClip(name, opts) { this.audio.play(name, opts); }
    stopClip(name)        { this.audio.stop(name); }
    get clips()           { return this.audio.clips; }

    raycast(origin, direction, maxDist) {
        return this.physics.raycast(origin, direction, maxDist);
    }
}
