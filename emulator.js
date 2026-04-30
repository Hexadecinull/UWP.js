import { UWPjsParser }       from './parser.js';
import { UWPjsRuntime }      from './runtime.js';
import { UWPjsRenderer }     from './renderer.js';
import { UWPjsAudio }        from './audio.js';
import { parseSerializedFile } from './serializedf.js';

export class UWPjs {
    constructor(buffer, opts = {}) {
        this.buffer   = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
        this.opts     = opts;
        this.parser   = new UWPjsParser(this.buffer);
        this.runtime  = new UWPjsRuntime();
        this.renderer = new UWPjsRenderer(opts.canvasId ?? 'game-canvas');
        this.audio    = new UWPjsAudio();
        this._log     = opts.onLog ?? (msg => console.log('[UWPjs]', msg));

        this.runtime.on('log', msg => this._log(msg));
    }

    async start() {
        this._log('Parsing bundle …');

        const parsed = this.parser.parse();
        if (!parsed.ok) {
            this._log(`Bundle parse failed: ${parsed.error}`);
            return { ok: false, error: parsed.error };
        }

        this._log(`Format: ${parsed.bundleKind} — ${parsed.headerStr}`);

        const files  = parsed.files ?? [];
        const sfList = [];

        for (const f of files) {
            if (f.name.endsWith('.dll') || f.name.endsWith('.mdb') || f.name.endsWith('.pdb')) continue;

            let sf;
            try {
                sf = parseSerializedFile(f.buffer, f.name);
            } catch (e) {
                this._log(`  Parse error (${f.name}): ${e.message}`);
                continue;
            }

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
            this._log(`Audio: ${this.audio.clips.length} clips loaded — ${this.audio.clips.join(', ')}`);
        }

        this.runtime.simulateLifecycle(scene);
        this.renderer.loadMeshes(allObjects);

        const sceneNodes = this.runtime.getSceneNodes();
        this.renderer.setSceneNodes(sceneNodes);

        if (sceneNodes.length > 0) {
            const names = sceneNodes.map(n => `${n.name}(${n.meshName})`).slice(0, 8).join(', ');
            this._log(`Render nodes: ${sceneNodes.length} — ${names}${sceneNodes.length > 8 ? ' …' : ''}`);
        }

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

        this.runtime.startLoop(() => this.renderer.renderFrame());
        this._log('Game loop started.');

        return { ok: true, scene, sfCount: sfList.length };
    }

    stop() {
        this.runtime.stopLoop();
        this.audio.stopAll();
        this._log('Stopped.');
    }

    playClip(name, opts) { this.audio.play(name, opts); }
    stopClip(name)        { this.audio.stop(name); }
    get clips()           { return this.audio.clips; }
}
