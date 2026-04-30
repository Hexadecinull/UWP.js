const AUDIO_FMT = {
    1:  'PCM',
    2:  'PCM',
    14: 'PCM',
    20: 'PCM',
    15: 'ADPCM',
    16: 'MP3',
    17: 'Vorbis',
    18: 'AAC',
};

function decodePCM(raw, channels, bitsPerSample) {
    const samples = raw.length / (bitsPerSample >> 3);
    const f32     = new Float32Array(samples);
    if (bitsPerSample === 8) {
        for (let i = 0; i < samples; i++) f32[i] = (raw[i] - 128) / 128;
    } else if (bitsPerSample === 16) {
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let i = 0; i < samples; i++) f32[i] = view.getInt16(i * 2, true) / 32768;
    } else if (bitsPerSample === 32) {
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let i = 0; i < samples; i++) f32[i] = view.getFloat32(i * 4, true);
    }
    return f32;
}

function decodeIMAADPCM(raw, channels) {
    const STEP_TABLE = [7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,158,175,193,213,235,258,284,313,345,379,417,459,505,555,611,672,739,813,894,984,1047,1152,1270,1399,1547,1720,1894,2088,2303,2544,2812,3110];
    const INDEX_TABLE = [-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8];

    const blockSize   = channels === 2 ? 2048 : 1024;
    const samplesPerBlock = channels === 2 ? 2036 : 2041;
    const blocks      = Math.floor(raw.length / blockSize);
    const totalSamples = blocks * samplesPerBlock * channels;
    const out          = new Float32Array(totalSamples);

    let outPos = 0;
    for (let b = 0; b < blocks; b++) {
        const bOff = b * blockSize;
        const stepIdxCh = [], predCh = [];

        for (let ch = 0; ch < channels; ch++) {
            const hOff = bOff + ch * 4;
            const view  = new DataView(raw.buffer, raw.byteOffset + hOff, 4);
            predCh[ch]     = view.getInt16(0, true);
            stepIdxCh[ch]  = Math.max(0, Math.min(63, raw[hOff + 2]));
            out[outPos++]  = predCh[ch] / 32768;
        }

        const dataStart = bOff + channels * 4;
        const pairs     = channels === 2 ? 8 : 4;
        let   dataOff   = dataStart;

        while (outPos < (b + 1) * samplesPerBlock * channels + channels) {
            for (let ch = 0; ch < channels; ch++) {
                for (let s = 0; s < pairs * 2; s++) {
                    if (dataOff >= raw.length) break;
                    const byte = raw[dataOff + Math.floor(s / 2)];
                    const nibble = (s & 1) ? (byte >> 4) & 0xF : byte & 0xF;
                    const step   = STEP_TABLE[stepIdxCh[ch]];
                    let delta    = step >> 3;
                    if (nibble & 1) delta += step >> 2;
                    if (nibble & 2) delta += step >> 1;
                    if (nibble & 4) delta += step;
                    if (nibble & 8) delta = -delta;
                    predCh[ch]    = Math.max(-32768, Math.min(32767, predCh[ch] + delta));
                    stepIdxCh[ch] = Math.max(0, Math.min(63, stepIdxCh[ch] + INDEX_TABLE[nibble]));
                    if (outPos < out.length) out[outPos++] = predCh[ch] / 32768;
                }
                dataOff += pairs;
            }
            if (dataOff >= bOff + blockSize) break;
        }
    }
    return out.subarray(0, outPos);
}

async function decodeCompressed(raw, mimeType, ctx) {
    try {
        const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        return await ctx.decodeAudioData(ab);
    } catch {
        return null;
    }
}

export class UWPjsAudio {
    constructor() {
        this._ctx     = null;
        this._clips   = new Map();
        this._sources = [];
        this._master  = null;
    }

    _ensureCtx() {
        if (!this._ctx) {
            this._ctx   = new (window.AudioContext || window.webkitAudioContext)();
            this._master = this._ctx.createGain();
            this._master.connect(this._ctx.destination);
            this._master.gain.value = 1.0;
        }
        return this._ctx;
    }

    async loadClip(asset) {
        const ctx      = this._ensureCtx();
        const name     = asset.name || `clip_${this._clips.size}`;
        const channels  = asset.channels  ?? 1;
        const frequency = asset.frequency ?? 44100;
        const bits      = asset.bitsPerSample ?? 16;
        const fmtId     = asset.compressionFormat ?? asset.m_Format ?? 2;
        const fmtName   = AUDIO_FMT[fmtId] ?? 'PCM';

        let audioBuffer = null;

        const rawField = asset.m_AudioData ?? asset.audioData ?? asset.data;
        const raw = rawField?.raw instanceof Uint8Array ? rawField.raw : rawField instanceof Uint8Array ? rawField : null;

        if (!raw || raw.length === 0) {
            console.warn(`[UWPjsAudio] ${name}: no audio data`);
            return null;
        }

        if (fmtName === 'PCM') {
            const f32 = decodePCM(raw, channels, bits);
            const spCh = Math.ceil(f32.length / channels);
            audioBuffer = ctx.createBuffer(channels, spCh, frequency);
            for (let ch = 0; ch < channels; ch++) {
                const chData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < spCh; i++) chData[i] = f32[i * channels + ch];
            }
        } else if (fmtName === 'ADPCM') {
            const f32 = decodeIMAADPCM(raw, channels);
            const spCh = Math.ceil(f32.length / channels);
            audioBuffer = ctx.createBuffer(channels, spCh, frequency);
            for (let ch = 0; ch < channels; ch++) {
                const chData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < spCh; i++) chData[i] = f32[i * channels + ch];
            }
        } else if (fmtName === 'MP3' || fmtName === 'Vorbis' || fmtName === 'AAC') {
            const mime = fmtName === 'MP3' ? 'audio/mpeg' : fmtName === 'AAC' ? 'audio/aac' : 'audio/ogg';
            audioBuffer = await decodeCompressed(raw, mime, ctx);
        }

        if (!audioBuffer) {
            console.warn(`[UWPjsAudio] ${name}: failed to decode format ${fmtName}`);
            return null;
        }

        this._clips.set(name, audioBuffer);
        console.log(`[UWPjsAudio] Loaded: ${name} (${fmtName}, ${channels}ch, ${frequency}Hz, ${(raw.length/1024).toFixed(1)} KB)`);
        return audioBuffer;
    }

    async loadAll(sfObjects) {
        const clips = sfObjects.filter(o => o.classID === 83);
        for (const clip of clips) await this.loadClip(clip);
        return this._clips.size;
    }

    play(name, opts = {}) {
        const ctx = this._ensureCtx();
        if (ctx.state === 'suspended') ctx.resume();
        const buf = this._clips.get(name);
        if (!buf) { console.warn(`[UWPjsAudio] play: clip "${name}" not found`); return null; }

        const src  = ctx.createBufferSource();
        src.buffer = buf;
        src.loop   = opts.loop ?? false;

        const gain = ctx.createGain();
        gain.gain.value = opts.volume ?? 1.0;
        src.connect(gain);
        gain.connect(this._master);
        src.start(0, opts.offset ?? 0);
        this._sources.push({ src, gain, name });
        src.onended = () => {
            this._sources = this._sources.filter(s => s.src !== src);
        };
        return { src, gain };
    }

    stop(name) {
        this._sources.filter(s => s.name === name).forEach(s => { try { s.src.stop(); } catch {} });
    }

    stopAll() {
        this._sources.forEach(s => { try { s.src.stop(); } catch {} });
        this._sources = [];
    }

    setMasterVolume(v) {
        this._ensureCtx();
        this._master.gain.value = Math.max(0, Math.min(1, v));
    }

    get clips() { return [...this._clips.keys()]; }
}
