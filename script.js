const themeToggle    = document.getElementById('theme-toggle');
const docEl          = document.documentElement;
const unityFileInput = document.getElementById('unity-file');
const statusDiv      = document.getElementById('status');
const assetList      = document.getElementById('asset-list');
const runtimeLog     = document.getElementById('runtime-log');
const scenePanel     = document.getElementById('scene-panel');

let darkMode = localStorage.getItem('theme') === 'dark' ||
    (localStorage.getItem('theme') === null && window.matchMedia('(prefers-color-scheme: dark)').matches);

function applyTheme() {
    docEl.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    themeToggle.textContent = darkMode ? '☀️' : '🌙';
}

themeToggle.addEventListener('click', () => {
    darkMode = !darkMode;
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
    applyTheme();
});

applyTheme();

function setStatus(text)    { statusDiv.textContent = text; }
function appendStatus(text) { statusDiv.textContent += '\n' + text; }
function clearAssets()      { assetList.innerHTML = '';  }
function clearScene() {
    if (scenePanel) {
        scenePanel.innerHTML = '';
        scenePanel.closest('#scene-wrap')?.style.removeProperty('display');
    }
    document.getElementById('log-wrap')?.style.removeProperty('display');
}

function appendRuntimeLog(msg) {
    if (!runtimeLog) return;
    const line = document.createElement('div');
    line.textContent = msg;
    runtimeLog.appendChild(line);
    runtimeLog.scrollTop = runtimeLog.scrollHeight;
}

function makeCard(label, sub, blob, dlName) {
    const card = document.createElement('div');
    card.className = 'asset-card';

    if (blob) {
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src     = url;
        img.loading = 'lazy';
        img.onload  = () => URL.revokeObjectURL(url);
        card.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className   = 'asset-meta';
    meta.textContent = label;
    card.appendChild(meta);

    if (sub) {
        const s = document.createElement('div');
        s.className   = 'asset-sub';
        s.textContent = sub;
        card.appendChild(s);
    }

    if (dlName && blob) {
        const actions = document.createElement('div');
        actions.className = 'asset-actions';
        const url2 = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href      = url2;
        a.download  = dlName;
        a.textContent = '↓ Save';
        a.onclick   = () => setTimeout(() => URL.revokeObjectURL(url2), 2000);
        actions.appendChild(a);
        card.appendChild(actions);
    }

    assetList.appendChild(card);
    return card;
}

function makeSectionHeader(title, count) {
    const h = document.createElement('div');
    h.className   = 'section-header';
    h.textContent = count != null ? `${title}  (${count})` : title;
    assetList.appendChild(h);
}

function bytesToHex(u8, len) {
    let s = '';
    for (let i = 0; i < Math.min(len, u8.length); i++)
        s += u8[i].toString(16).padStart(2, '0') + ' ';
    return s.trim();
}

async function handleTextures(objects) {
    const { decodeTexture2D } = await import('./textures.js');
    const textures = objects.filter(o => o.classID === 28 && o.imageData);
    if (!textures.length) return;
    makeSectionHeader('Textures', textures.length);
    for (const tex of textures) {
        try {
            const blob = await decodeTexture2D(tex.imageData, tex.width, tex.height, tex.textureFormat);
            if (blob) {
                makeCard(
                    tex.name || '(unnamed)',
                    `${tex.width}×${tex.height}  ${tex.formatName}`,
                    blob,
                    `${tex.name || 'texture'}.png`
                );
            } else {
                makeCard(tex.name || '(unnamed)', `${tex.width}×${tex.height}  ${tex.formatName} — unsupported format`);
            }
        } catch (err) {
            makeCard(tex.name || '(unnamed)', `Decode error: ${err.message}`);
        }
    }
}

function handleTextAssets(objects) {
    const texts = objects.filter(o => o.classID === 49 && o.text);
    if (!texts.length) return;
    makeSectionHeader('Text Assets', texts.length);
    for (const t of texts) {
        const card = makeCard(t.name || '(unnamed)', t.text.slice(0, 120) + (t.text.length > 120 ? '…' : ''));
        const blob = new Blob([t.text], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const actions = document.createElement('div');
        actions.className = 'asset-actions';
        const a = document.createElement('a');
        a.href = url; a.download = `${t.name || 'text'}.txt`;
        a.textContent = '↓ Save';
        a.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 2000);
        actions.appendChild(a);
        card.appendChild(actions);
    }
}

function handleAudio(objects, emulator) {
    const clips = objects.filter(o => o.classID === 83);
    if (!clips.length) return;
    makeSectionHeader('Audio Clips', clips.length);
    for (const clip of clips) {
        const card = makeCard(
            clip.name || '(unnamed)',
            `${clip.channels ?? '?'}ch  ${clip.frequency ?? '?'} Hz  ${clip.bitsPerSample ?? '?'}-bit`
        );
        const actions = document.createElement('div');
        actions.className = 'asset-actions';
        if (emulator && clip.name) {
            const btn = document.createElement('button');
            btn.textContent = '▶ Play';
            btn.onclick = () => emulator.playClip(clip.name);
            actions.appendChild(btn);
        }
        const wav = audioToWAV(clip);
        if (wav) {
            const url = URL.createObjectURL(wav);
            const a   = document.createElement('a');
            a.href = url; a.download = `${clip.name || 'audio'}.wav`;
            a.textContent = '↓ WAV';
            a.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 2000);
            actions.appendChild(a);
        }
        if (actions.children.length) card.appendChild(actions);
    }
}

function audioToWAV(asset) {
    const rawField = asset.m_AudioData ?? asset.audioData;
    const raw = rawField?.raw instanceof Uint8Array ? rawField.raw : null;
    if (!raw || raw.length === 0) return null;
    const channels = asset.channels ?? 1;
    const rate     = asset.frequency ?? 44100;
    const bits     = asset.bitsPerSample ?? 16;
    const blockAlign = channels * (bits >> 3);
    const buf = new ArrayBuffer(44 + raw.length);
    const dv  = new DataView(buf);
    const wr4 = (p, s) => { for (let i=0;i<4;i++) dv.setUint8(p+i, s.charCodeAt(i)); };
    wr4(0,'RIFF'); dv.setUint32(4, 36+raw.length, true);
    wr4(8,'WAVE'); wr4(12,'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, channels, true); dv.setUint32(24, rate, true);
    dv.setUint32(28, rate*blockAlign, true); dv.setUint16(32, blockAlign, true);
    dv.setUint16(34, bits, true); wr4(36,'data'); dv.setUint32(40, raw.length, true);
    new Uint8Array(buf, 44).set(raw);
    return new Blob([buf], { type: 'audio/wav' });
}

function handleMeshes(objects) {
    const meshes = objects.filter(o => o.classID === 43);
    if (!meshes.length) return;
    makeSectionHeader('Meshes', meshes.length);
    for (const m of meshes) {
        const card = makeCard(m.name || '(unnamed)', m.parseError ? `Parse error: ${m.parseError}` : 'Mesh');
        const objStr = m.meshData && !m.parseError ? meshToOBJ(m.meshData, m.name || 'mesh') : null;
        if (objStr) {
            const actions = document.createElement('div');
            actions.className = 'asset-actions';
            const blob = new Blob([objStr], { type: 'text/plain' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = `${m.name || 'mesh'}.obj`;
            a.textContent = '↓ OBJ';
            a.onclick = () => setTimeout(() => URL.revokeObjectURL(url), 2000);
            actions.appendChild(a);
            card.appendChild(actions);
        }
    }
}

function meshToOBJ(meshData, name) {
    try {
        let positions = null, normals = null, uvs = null, faces = null;
        const mv = meshData?.m_Vertices ?? meshData?.vertices;
        if (mv?.raw instanceof Uint8Array) {
            const r  = mv.raw;
            const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
            const n  = r.byteLength >> 2;
            positions = [];
            for (let i = 0; i < n; i += 3) positions.push([dv.getFloat32(i*4,true), dv.getFloat32((i+1)*4,true), dv.getFloat32((i+2)*4,true)]);
        }
        if (!positions?.length) return null;
        const ir = meshData.m_IndexBuffer ?? meshData.m_Indices;
        if (ir?.raw instanceof Uint8Array) {
            const r  = ir.raw;
            const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
            faces = [];
            if (r.byteLength % 4 === 0) {
                for (let i = 0; i < r.byteLength; i += 12) faces.push([dv.getUint32(i,true)+1, dv.getUint32(i+4,true)+1, dv.getUint32(i+8,true)+1]);
            } else {
                for (let i = 0; i < r.byteLength; i += 6) faces.push([dv.getUint16(i,true)+1, dv.getUint16(i+2,true)+1, dv.getUint16(i+4,true)+1]);
            }
        }
        let obj = `# Exported by UWP.js\n# Mesh: ${name}\n\n`;
        for (const [x,y,z] of positions) obj += `v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
        obj += '\n';
        if (faces) for (const [a,b,c] of faces) obj += `f ${a} ${b} ${c}\n`;
        return obj;
    } catch { return null; }
}

function handleOtherAssets(objects) {
    const skip = new Set([28, 49, 43, 83]);
    const rest = objects.filter(o => !skip.has(o.classID));
    if (!rest.length) return;
    const byClass = new Map();
    for (const o of rest) {
        if (!byClass.has(o.className)) byClass.set(o.className, []);
        byClass.get(o.className).push(o);
    }
    makeSectionHeader('Other Assets', rest.length);
    for (const [cls, items] of byClass) {
        const names = items.map(i => i.name || '?').filter(Boolean).slice(0, 8).join(', ');
        makeCard(cls, `${items.length} object${items.length !== 1 ? 's' : ''}${names ? ' — ' + names : ''}`);
    }
}

function buildAssemblyPanel(scene) {
    if (!scenePanel || !scene?.assemblyTypes?.length) return;
    const h = document.createElement('div');
    h.className = 'section-header';
    h.textContent = `Script Types — ${scene.assemblyTypes.length}`;
    scenePanel.appendChild(h);
    for (const t of scene.assemblyTypes.slice(0, 100)) {
        const row = document.createElement('div');
        row.className   = 'scene-row';
        row.textContent = t;
        scenePanel.appendChild(row);
    }
}

function buildSceneTree(scene) {
    if (!scenePanel || !scene) return;
    clearScene();

    const header = document.createElement('div');
    header.className   = 'section-header';
    header.textContent = `Scene Graph — ${scene.gameObjects.length} GameObjects`;
    scenePanel.appendChild(header);

    for (const go of scene.gameObjects.slice(0, 200)) {
        const row = document.createElement('div');
        row.className   = 'scene-row';
        row.textContent = `${go.isActive ? '◉' : '○'} ${go.name}`;
        if (go.localPosition) {
            const pos = go.localPosition;
            const sub = document.createElement('span');
            sub.className   = 'scene-pos';
            sub.textContent = ` (${(pos.x??0).toFixed(2)}, ${(pos.y??0).toFixed(2)}, ${(pos.z??0).toFixed(2)})`;
            row.appendChild(sub);
        }
        scenePanel.appendChild(row);
    }

    if (scene.assemblies?.length) {
        const aHeader = document.createElement('div');
        aHeader.className   = 'section-header';
        aHeader.textContent = `Assemblies — ${scene.assemblies.length}`;
        scenePanel.appendChild(aHeader);
        for (const a of scene.assemblies) {
            const row = document.createElement('div');
            row.className   = 'scene-row';
            row.textContent = a;
            scenePanel.appendChild(row);
        }
    }
}

let activeEmulator = null;

unityFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    clearAssets();
    clearScene();
    if (runtimeLog) runtimeLog.innerHTML = '';

    if (activeEmulator) { activeEmulator.stop(); activeEmulator = null; }

    if (!file) { setStatus('No file selected.'); return; }
    if (!file.name.endsWith('.unity3d')) { setStatus('Please select a .unity3d file.'); return; }

    setStatus(`Reading ${file.name} (${(file.size / 1024).toFixed(1)} KB) …`);

    const buffer = await file.arrayBuffer();
    const u8head = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
    appendStatus(`Signature: ${bytesToHex(u8head, 8)}`);

    const { UWPjsParser } = await import('./parser.js');
    const parser = new UWPjsParser(buffer);

    let parsed;
    try {
        parsed = parser.parse();
    } catch (err) {
        setStatus(`Parse exception: ${err.message ?? err}`);
        return;
    }

    appendStatus(`Format  : ${parsed.bundleKind ?? 'unknown'}`);
    appendStatus(`Bundle  : ${parsed.headerStr ?? '—'}`);
    if (parsed.error)  appendStatus(`Note    : ${parsed.error}`);
    if (parsed.blocks) appendStatus(`Blocks  : ${parsed.blocks.length}`);
    if (parsed.dirs)   appendStatus(`Entries : ${parsed.dirs.length}`);

    const files = parsed.files ?? [];
    appendStatus(`Files   : ${files.length}`);

    if (!files.length) {
        const p = document.createElement('p');
        p.className   = 'placeholder';
        p.textContent = parsed.error ?? 'No files could be extracted from this bundle.';
        assetList.appendChild(p);
        return;
    }

    const { parseSerializedFile } = await import('./serializedf.js');

    let totalObjects = 0;
    const allObjects = [];
    const sfList     = [];

    for (const f of files) {
        if (f.name.endsWith('.dll') || f.name.endsWith('.mdb')) {
            appendStatus(`  Assembly: ${f.name}`);
            continue;
        }

        appendStatus(`\nParsing ${f.name} …`);
        let sf;
        try {
            sf = parseSerializedFile(f.buffer, f.name);
        } catch (err) {
            makeCard(f.name, `SerializedFile parse error: ${err.message ?? err}`);
            continue;
        }

        if (!sf.ok) {
            const blob = new Blob([f.buffer], { type: 'application/octet-stream' });
            makeCard(f.name, `${sf.error ?? 'Could not parse'} — raw download`, blob, f.name);
            continue;
        }

        appendStatus(`  Unity ${sf.unityVersion}  SF v${sf.version}  types=${sf.typeCount}  objects=${sf.objectCount}${sf.truncated ? ' (capped at 2000)' : ''}`);
        totalObjects += sf.objectCount;
        allObjects.push(...sf.objects);
        sfList.push(sf);

        await handleTextures(sf.objects);
        handleTextAssets(sf.objects);
        handleMeshes(sf.objects);
        handleAudio(sf.objects, null);
    }

    appendStatus(`\nDone — ${totalObjects} total object${totalObjects !== 1 ? 's' : ''} across ${files.length} file${files.length !== 1 ? 's' : ''}.`);

    const { UWPjs } = await import('./emulator.js');
    activeEmulator = new UWPjs(buffer, {
        canvasId: 'game-canvas',
        onLog: msg => appendRuntimeLog(msg),
    });
    const result = await activeEmulator.start();

    if (result?.isDrop) {
        if (scenePanel)  scenePanel.closest('#scene-wrap')?.style.setProperty('display','none');
        document.getElementById('log-wrap')?.style.setProperty('display','none');
        const hint = document.createElement('p');
        hint.className   = 'placeholder';
        hint.textContent = 'Drop by Notch loaded — click the canvas and press D to play, S to toggle sound.';
        assetList.appendChild(hint);
        return;
    }

    if (result?.scene) {
        buildSceneTree(result.scene);
        buildAssemblyPanel(result.scene);
    }

    for (const sf of sfList ?? []) {
        handleAudio(sf.objects, activeEmulator);
        handleOtherAssets(sf.objects);
    }
});
