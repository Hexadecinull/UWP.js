const WORDS = [
    'aware','beauty','clean','deconstruct','eternal','fractal','gnostic','harmony',
    'insight','journey','know','lucid','mind','nothing','open','polygon','question',
    'reward','space','truth','universe','visual','warm','lonely','afraid','bitter',
    'sad','jealous','scared','angry','insane','dead','insecure','ashamed','isolated',
    'unheard','unloved',
];

const HELP_TEXT =
    'drop 1.4 by markus persson 2013\n\n' +
    'press d to start playing.\n' +
    'type blinking letter to advance.\n' +
    'press space or enter to submit.\n' +
    'bonus points if more than four letters.\n' +
    'game gets faster. game over if letter leaves screen.\n' +
    'wrong letter speeds up.\n\n' +
    'everything is real. nothing is real.';

const COLORS = {
    bg:        '#0a0a0f',
    cube:      'rgba(255,255,255,0.92)',
    cubeEdge:  'rgba(255,255,255,0.18)',
    wordDim:   'rgba(255,255,255,0.28)',
    wordBright:'rgba(255,255,255,0.95)',
    wordDone:  'rgba(255,255,255,0.12)',
    blink:     '#ffffff',
    hud:       'rgba(255,255,255,0.55)',
    hudBright: '#ffffff',
    flash:     'rgba(255,255,255,',
};

function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function shuffleArr(a) { for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

class Word {
    constructor(text, y, speed) {
        this.text    = text;
        this.y       = y;
        this.speed   = speed;
        this.cursor  = 0;
        this.done    = false;
        this.missed  = false;
    }
}

class Cube {
    constructor(size, offx, offy, period, chaos) {
        this.size   = size;
        this.offx   = offx;
        this.offy   = offy;
        this.period = period;
        this.chaos  = chaos;
        this.rotX   = rnd(0, Math.PI*2);
        this.rotY   = rnd(0, Math.PI*2);
        this.rotZ   = rnd(0, Math.PI*2);
        this.velX   = rnd(-0.3, 0.3);
        this.velY   = rnd(-0.3, 0.3);
        this.velZ   = rnd(-0.3, 0.3);
    }

    update(dt) {
        this.rotX += this.velX * dt;
        this.rotY += this.velY * dt;
        this.rotZ += this.velZ * dt;
    }
}

function projectCube(cube, cx, cy, fov) {
    const s  = cube.size;
    const verts = [
        [-s,-s,-s],[ s,-s,-s],[ s, s,-s],[-s, s,-s],
        [-s,-s, s],[ s,-s, s],[ s, s, s],[-s, s, s],
    ];

    const cosX=Math.cos(cube.rotX), sinX=Math.sin(cube.rotX);
    const cosY=Math.cos(cube.rotY), sinY=Math.sin(cube.rotY);
    const cosZ=Math.cos(cube.rotZ), sinZ=Math.sin(cube.rotZ);

    const projected = verts.map(([x,y,z]) => {
        let x2=x, y2=y*cosX-z*sinX, z2=y*sinX+z*cosX;
        let x3=x2*cosY+z2*sinY, y3=y2, z3=-x2*sinY+z2*cosY;
        let x4=x3*cosZ-y3*sinZ, y4=x3*sinZ+y3*cosZ, z4=z3;
        const dist = fov / (fov + z4 + 3.5);
        return [cx + (x4 + cube.offx) * dist, cy + (y4 + cube.offy) * dist, z4, dist];
    });

    const faces = [
        [0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[0,3,7,4],[1,2,6,5],
    ];

    const visible = faces.filter(f => {
        const [a,b,c] = [projected[f[0]], projected[f[1]], projected[f[2]]];
        const cross = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
        return cross > 0;
    });

    return { projected, faces: visible };
}

function drawCube(ctx, cube, cx, cy, fov, alpha) {
    const { projected, faces } = projectCube(cube, cx, cy, fov);

    ctx.save();
    ctx.globalAlpha = alpha * 0.08;
    for (const face of faces) {
        ctx.beginPath();
        for (let i=0;i<face.length;i++) {
            const [px,py] = projected[face[i]];
            if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = COLORS.cube;
    ctx.lineWidth = 1.5;
    for (const face of faces) {
        ctx.beginPath();
        for (let i=0;i<face.length;i++) {
            const [px,py] = projected[face[i]];
            if (i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath();
        ctx.stroke();
    }
    ctx.restore();
}

export class DropGame {
    constructor(canvas, audioCtx) {
        this.canvas   = canvas;
        this.ctx      = canvas.getContext('2d');
        this.audio    = audioCtx;
        this._running = false;
        this._raf     = null;
        this._prev    = 0;
        this._elapsed = 0;
        this._blinkT  = 0;

        this.state    = 'title';
        this.words    = [];
        this.wordPool = shuffleArr([...WORDS]);
        this.poolIdx  = 0;
        this.score    = 0;
        this.best     = parseInt(localStorage.getItem('drop_best') || '0', 10);
        this.speed    = 28;
        this.spawnInterval = 3.2;
        this._spawnT  = 1.5;
        this.soundOn  = true;
        this.flashMsg = '';
        this.flashT   = 0;
        this.showHelp = true;

        this.cubes = [
            new Cube(0.90, 0, 0, 7.2, 0.12),
            new Cube(0.56, 0, 0, 5.1, 0.18),
            new Cube(0.32, 0, 0, 3.8, 0.22),
        ];

        this._osc   = null;
        this._gainNode = null;
        this._initAudio();
    }

    _initAudio() {
        if (!this.audio) return;
        this._gainNode = this.audio.createGain();
        this._gainNode.gain.value = 0.18;
        this._gainNode.connect(this.audio.destination);
    }

    _beep(freq, dur, vol=0.4, type='sine') {
        if (!this.audio || !this.soundOn) return;
        if (this.audio.state === 'suspended') this.audio.resume();
        const osc  = this.audio.createOscillator();
        const gain = this.audio.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, this.audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + dur);
        osc.connect(gain); gain.connect(this._gainNode);
        osc.start(); osc.stop(this.audio.currentTime + dur);
    }

    _nextWord() {
        if (this.poolIdx >= this.wordPool.length) {
            this.wordPool = shuffleArr([...WORDS]);
            this.poolIdx  = 0;
        }
        return this.wordPool[this.poolIdx++];
    }

    _spawnWord() {
        const text = this._nextWord();
        this.words.push(new Word(text, this.canvas.height + 20, this.speed));
    }

    start() {
        this._running = true;
        this._prev    = performance.now();
        this._tick();
    }

    stop() {
        this._running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    }

    _startGame() {
        this.state         = 'playing';
        this.words         = [];
        this.poolIdx       = 0;
        this.wordPool      = shuffleArr([...WORDS]);
        this.score         = 0;
        this.speed         = 28;
        this.spawnInterval = 3.2;
        this._spawnT       = 0.5;
        this._elapsed      = 0;
        this.flashMsg      = '';
        this.flashT        = 0;
        this.showHelp      = false;
    }

    _gameOver() {
        this.state = 'gameover';
        if (this.score > this.best) {
            this.best = this.score;
            localStorage.setItem('drop_best', String(this.best));
        }
        this._beep(180, 0.6, 0.5, 'sawtooth');
        setTimeout(() => this._beep(120, 0.8, 0.4, 'sawtooth'), 200);
    }

    handleKey(key) {
        if (this.audio?.state === 'suspended') this.audio.resume();

        if (this.state === 'title' || this.state === 'gameover') {
            if (key === 'd' || key === 'D') { this._startGame(); return; }
            if (key === 's' || key === 'S') { this.soundOn = !this.soundOn; return; }
            return;
        }

        if (this.state !== 'playing') return;
        if (key === 's' || key === 'S') { this.soundOn = !this.soundOn; return; }

        const active = this.words.find(w => !w.done && !w.missed);
        if (!active) return;

        const expected = active.text[active.cursor];

        if (key === ' ' || key === 'Enter') {
            if (active.cursor === active.text.length) {
                this._submitWord(active);
            } else {
                this._wrong();
            }
            return;
        }

        if (key.length === 1) {
            if (key.toLowerCase() === expected.toLowerCase()) {
                active.cursor++;
                this._beep(440 + active.cursor * 40, 0.07, 0.3);
                if (active.cursor === active.text.length) {
                    this._submitWord(active);
                }
            } else {
                this._wrong();
            }
        }
    }

    _submitWord(word) {
        word.done = true;
        const len  = word.text.length;
        const pts  = len <= 4 ? len : len + Math.pow(len - 4, 2);
        this.score += pts;
        this.flashMsg = '+' + pts;
        this.flashT   = 1.2;
        this.speed    = Math.min(95, this.speed + 0.8);
        this.spawnInterval = Math.max(1.1, this.spawnInterval - 0.06);
        this._beep(660, 0.12, 0.4);
        setTimeout(() => this._beep(880, 0.1, 0.35), 80);
    }

    _wrong() {
        this.speed = Math.min(120, this.speed + 6);
        this._beep(150, 0.15, 0.3, 'square');
    }

    _tick() {
        if (!this._running) return;
        const now = performance.now();
        const dt  = Math.min((now - this._prev) / 1000, 0.05);
        this._prev = now;

        this._update(dt);
        this._draw();

        this._raf = requestAnimationFrame(() => this._tick());
    }

    _update(dt) {
        this._elapsed += dt;
        this._blinkT  += dt;

        for (const cube of this.cubes) cube.update(dt);

        if (this.state !== 'playing') return;

        this.flashT = Math.max(0, this.flashT - dt);

        this._spawnT -= dt;
        if (this._spawnT <= 0) {
            this._spawnWord();
            this._spawnT = this.spawnInterval + rnd(-0.3, 0.3);
        }

        const active = this.words.find(w => !w.done && !w.missed);

        for (const w of this.words) {
            if (!w.done && !w.missed) {
                w.speed = this.speed;
            }
            w.y -= w.speed * dt;
        }

        for (const w of this.words) {
            if (!w.done && !w.missed && w.y < -30) {
                w.missed = true;
                this._gameOver();
                return;
            }
        }

        this.words = this.words.filter(w => w.y > -60);
    }

    _draw() {
        const ctx = this.ctx;
        const W   = this.canvas.width;
        const H   = this.canvas.height;
        const cx  = W * 0.5;
        const cy  = H * 0.42;

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);

        const cubeAlpha = this.state === 'playing' ? 0.5 : 0.85;
        for (const cube of this.cubes) {
            drawCube(ctx, cube, cx, cy, 3.2, cubeAlpha);
        }

        if (this.state === 'title') {
            this._drawTitle(ctx, W, H);
        } else if (this.state === 'playing') {
            this._drawPlaying(ctx, W, H);
        } else if (this.state === 'gameover') {
            this._drawGameOver(ctx, W, H);
        }
    }

    _drawTitle(ctx, W, H) {
        const cx = W * 0.5;
        ctx.save();
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font      = '11px monospace';
        const lines   = HELP_TEXT.split('\n');
        for (let i=0; i<lines.length; i++) {
            ctx.fillText(lines[i], cx, H*0.38 + i * 15);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font      = '11px monospace';
        ctx.fillText(`sound: ${this.soundOn ? 'on' : 'off'}  (press s)`, cx, H*0.85);
        ctx.fillText(`score: ${this.score} | best: ${this.best}`, cx, H*0.88);
        ctx.restore();
    }

    _drawPlaying(ctx, W, H) {
        const cx    = W * 0.5;
        const blink = (Math.sin(this._blinkT * 7.5) > 0);

        ctx.save();
        ctx.textAlign = 'center';

        const active = this.words.find(w => !w.done && !w.missed);

        for (const word of this.words) {
            if (word.done || word.missed) continue;
            const isActive = word === active;
            const x = cx + (isActive ? 0 : rnd(-1, 1));
            const y = word.y;

            ctx.font = `${isActive ? 'bold ' : ''}18px monospace`;

            for (let i = 0; i < word.text.length; i++) {
                const ch    = word.text[i];
                const typed = i < word.cursor;
                const curr  = i === word.cursor;
                const ahead = i > word.cursor;

                let col;
                if (typed)      col = COLORS.wordDone;
                else if (curr && isActive && blink) col = COLORS.blink;
                else if (curr && isActive) col = 'rgba(255,255,255,0.55)';
                else if (ahead && isActive) col = COLORS.wordBright;
                else            col = COLORS.wordDim;

                const charW = 11;
                const totalW = word.text.length * charW;
                const charX  = x - totalW/2 + i * charW + charW/2;

                ctx.fillStyle = col;
                ctx.fillText(ch, charX, y);
            }

            if (isActive && word.cursor < word.text.length) {
                const charW  = 11;
                const totalW = word.text.length * charW;
                const curX   = x - totalW/2 + word.cursor * charW + charW/2;
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.font = '11px monospace';
                ctx.fillText('_', curX, y + 14);
            }
        }

        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle    = COLORS.hud;
        ctx.font         = '11px monospace';
        ctx.fillText(`score: ${this.score}`, 14, 14);
        ctx.fillText(`best: ${this.best}`, 14, 28);
        ctx.fillText(`sound: ${this.soundOn ? 'on' : 'off'}`, 14, 42);

        if (this.flashT > 0) {
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha  = Math.min(1, this.flashT);
            ctx.fillStyle    = '#ffffff';
            ctx.font         = 'bold 28px monospace';
            ctx.fillText(this.flashMsg, W * 0.5, H * 0.62);
            ctx.globalAlpha  = 1;
        }

        ctx.restore();
    }

    _drawGameOver(ctx, W, H) {
        const cx = W * 0.5;
        ctx.save();
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font      = 'bold 22px monospace';
        ctx.fillText('game over', cx, H * 0.52);

        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font      = '14px monospace';
        ctx.fillText(`score: ${this.score}`, cx, H * 0.58);
        if (this.score >= this.best) {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText('new best!', cx, H * 0.63);
        } else {
            ctx.fillText(`best: ${this.best}`, cx, H * 0.63);
        }

        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font      = '11px monospace';
        ctx.fillText('press d to play again', cx, H * 0.72);
        ctx.fillText(`sound: ${this.soundOn ? 'on' : 'off'}  (press s)`, cx, H * 0.76);

        ctx.restore();
    }
}
