const KEY_MAP = {
    ' ':'Space','Enter':'Return','Escape':'Escape','Backspace':'Backspace',
    'Tab':'Tab','Delete':'Delete','Insert':'Insert','Home':'Home','End':'End',
    'PageUp':'PageUp','PageDown':'PageDown','ArrowUp':'UpArrow','ArrowDown':'DownArrow',
    'ArrowLeft':'LeftArrow','ArrowRight':'RightArrow','Shift':'LeftShift',
    'Control':'LeftControl','Alt':'LeftAlt','CapsLock':'CapsLock',
    'F1':'F1','F2':'F2','F3':'F3','F4':'F4','F5':'F5','F6':'F6',
    'F7':'F7','F8':'F8','F9':'F9','F10':'F10','F11':'F11','F12':'F12',
    'a':'a','b':'b','c':'c','d':'d','e':'e','f':'f','g':'g','h':'h',
    'i':'i','j':'j','k':'k','l':'l','m':'m','n':'n','o':'o','p':'p',
    'q':'q','r':'r','s':'s','t':'t','u':'u','v':'v','w':'w','x':'x',
    'y':'y','z':'z','0':'Alpha0','1':'Alpha1','2':'Alpha2','3':'Alpha3',
    '4':'Alpha4','5':'Alpha5','6':'Alpha6','7':'Alpha7','8':'Alpha8','9':'Alpha9',
    'Numpad0':'Keypad0','Numpad1':'Keypad1','Numpad2':'Keypad2','Numpad3':'Keypad3',
    'Numpad4':'Keypad4','Numpad5':'Keypad5','Numpad6':'Keypad6','Numpad7':'Keypad7',
    'Numpad8':'Keypad8','Numpad9':'Keypad9','NumpadDecimal':'KeypadPeriod',
    'NumpadAdd':'KeypadPlus','NumpadSubtract':'KeypadMinus',
    'NumpadMultiply':'KeypadMultiply','NumpadDivide':'KeypadDivide',
    'NumpadEnter':'KeypadEnter',
};

const UNITY_AXES = {
    'Horizontal': { pos: ['d','RightArrow'], neg: ['a','LeftArrow'], gravity: 3, sensitivity: 3, snap: true },
    'Vertical':   { pos: ['w','UpArrow'],    neg: ['s','DownArrow'], gravity: 3, sensitivity: 3, snap: true },
    'Fire1':      { pos: ['LeftControl','z'],neg: [], gravity: 1000, sensitivity: 1000, snap: false },
    'Fire2':      { pos: ['LeftAlt','x'],   neg: [], gravity: 1000, sensitivity: 1000, snap: false },
    'Fire3':      { pos: ['LeftShift','c'], neg: [], gravity: 1000, sensitivity: 1000, snap: false },
    'Jump':       { pos: ['Space'],          neg: [], gravity: 1000, sensitivity: 1000, snap: false },
    'Mouse X':    { mouse: true, axis: 0 },
    'Mouse Y':    { mouse: true, axis: 1 },
    'Mouse ScrollWheel': { mouse: true, axis: 2 },
};

export class UWPjsInput {
    constructor(element) {
        this._el        = element ?? window;
        this._keys      = new Map();
        this._keysDown  = new Set();
        this._keysUp    = new Set();
        this._mouse     = { x: 0, y: 0, dx: 0, dy: 0, scroll: 0, buttons: [false,false,false], btnDown: [false,false,false], btnUp: [false,false,false] };
        this._axes      = new Map();
        this._touches   = new Map();
        this._gamepads  = [];
        this._locked    = false;
        this._prevMouseX= 0;
        this._prevMouseY= 0;

        for (const name of Object.keys(UNITY_AXES)) this._axes.set(name, 0);

        this._attach();
    }

    _attach() {
        const el = this._el;

        el.addEventListener('keydown', e => {
            if (e.repeat) return;
            const k = this._mapKey(e);
            if (!this._keys.get(k)) this._keysDown.add(k);
            this._keys.set(k, true);
        });

        el.addEventListener('keyup', e => {
            const k = this._mapKey(e);
            this._keys.set(k, false);
            this._keysUp.add(k);
        });

        const cvs = el instanceof HTMLCanvasElement ? el : document.getElementById('game-canvas');
        if (cvs) {
            cvs.addEventListener('mousemove', e => {
                const r  = cvs.getBoundingClientRect();
                this._mouse.x  = e.clientX - r.left;
                this._mouse.y  = e.clientY - r.top;
                this._mouse.dx += this._locked ? (e.movementX ?? 0) : (e.clientX - this._prevMouseX);
                this._mouse.dy += this._locked ? (e.movementY ?? 0) : (e.clientY - this._prevMouseY);
                this._prevMouseX = e.clientX;
                this._prevMouseY = e.clientY;
            });

            cvs.addEventListener('mousedown', e => {
                const b = e.button;
                if (b < 3) { this._mouse.buttons[b] = true; this._mouse.btnDown[b] = true; }
            });

            cvs.addEventListener('mouseup', e => {
                const b = e.button;
                if (b < 3) { this._mouse.buttons[b] = false; this._mouse.btnUp[b] = true; }
            });

            cvs.addEventListener('wheel', e => {
                this._mouse.scroll -= e.deltaY / 120;
            }, { passive: true });

            cvs.addEventListener('contextmenu', e => e.preventDefault());

            cvs.addEventListener('touchstart', e => {
                for (const t of e.changedTouches) {
                    const r = cvs.getBoundingClientRect();
                    this._touches.set(t.identifier, { x: t.clientX - r.left, y: t.clientY - r.top, dx: 0, dy: 0, phase: 'Began' });
                }
                e.preventDefault();
            }, { passive: false });

            cvs.addEventListener('touchmove', e => {
                for (const t of e.changedTouches) {
                    const r   = cvs.getBoundingClientRect();
                    const old = this._touches.get(t.identifier);
                    const nx  = t.clientX - r.left, ny = t.clientY - r.top;
                    if (old) this._touches.set(t.identifier, { x: nx, y: ny, dx: nx - old.x, dy: ny - old.y, phase: 'Moved' });
                }
                e.preventDefault();
            }, { passive: false });

            cvs.addEventListener('touchend', e => {
                for (const t of e.changedTouches) {
                    const old = this._touches.get(t.identifier);
                    if (old) this._touches.set(t.identifier, { ...old, phase: 'Ended' });
                }
            });
        }

        window.addEventListener('gamepadconnected',    e => { this._gamepads[e.gamepad.index] = e.gamepad; });
        window.addEventListener('gamepaddisconnected', e => { delete this._gamepads[e.gamepad.index]; });
    }

    _mapKey(e) {
        return KEY_MAP[e.code] ?? KEY_MAP[e.key] ?? e.key ?? 'Unknown';
    }

    update(dt) {
        const gps = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gps) { if (gp) this._gamepads[gp.index] = gp; }

        for (const [name, def] of Object.entries(UNITY_AXES)) {
            if (def.mouse) continue;
            const cur = this._axes.get(name) ?? 0;
            const posHeld = def.pos.some(k => this._keys.get(k));
            const negHeld = def.neg.some(k => this._keys.get(k));
            let target = posHeld ? 1 : negHeld ? -1 : 0;

            if (def.snap && cur !== 0 && Math.sign(target) !== 0 && Math.sign(target) !== Math.sign(cur)) {
                this._axes.set(name, 0);
                continue;
            }

            let next;
            if (target !== 0) {
                next = cur + Math.sign(target) * def.sensitivity * dt;
                next = Math.max(-1, Math.min(1, next));
            } else {
                next = Math.abs(cur) < def.gravity * dt ? 0 : cur - Math.sign(cur) * def.gravity * dt;
            }
            this._axes.set(name, next);
        }

        this._axes.set('Mouse X', this._mouse.dx);
        this._axes.set('Mouse Y', -this._mouse.dy);
        this._axes.set('Mouse ScrollWheel', this._mouse.scroll);
    }

    lateUpdate() {
        this._keysDown.clear();
        this._keysUp.clear();
        this._mouse.btnDown = [false, false, false];
        this._mouse.btnUp   = [false, false, false];
        this._mouse.dx      = 0;
        this._mouse.dy      = 0;
        this._mouse.scroll  = 0;
        for (const [id, t] of this._touches) {
            if (t.phase === 'Ended') this._touches.delete(id);
            else this._touches.set(id, { ...t, phase: 'Stationary', dx: 0, dy: 0 });
        }
    }

    getKey(k)     { return this._keys.get(k) === true; }
    getKeyDown(k) { return this._keysDown.has(k); }
    getKeyUp(k)   { return this._keysUp.has(k); }

    getMouseButton(b)     { return this._mouse.buttons[b] === true; }
    getMouseButtonDown(b) { return this._mouse.btnDown[b] === true; }
    getMouseButtonUp(b)   { return this._mouse.btnUp[b] === true; }

    getMousePosition() { return { x: this._mouse.x, y: this._mouse.y }; }

    getAxis(name) {
        if (UNITY_AXES[name]?.mouse) return this._axes.get(name) ?? 0;
        return this._axes.get(name) ?? 0;
    }

    getAxisRaw(name) {
        const def = UNITY_AXES[name];
        if (!def) return 0;
        if (def.mouse) return this._axes.get(name) ?? 0;
        const pos = def.pos.some(k => this._keys.get(k));
        const neg = def.neg.some(k => this._keys.get(k));
        return pos ? 1 : neg ? -1 : 0;
    }

    get touchCount() { return this._touches.size; }
    getTouch(i)      { return [...this._touches.values()][i] ?? null; }

    getGamepadButton(gpIdx, btnIdx) {
        const gp = this._gamepads[gpIdx];
        return gp ? gp.buttons[btnIdx]?.pressed ?? false : false;
    }

    getGamepadAxis(gpIdx, axisIdx) {
        const gp = this._gamepads[gpIdx];
        return gp ? gp.axes[axisIdx] ?? 0 : 0;
    }

    lockCursor()   { document.getElementById('game-canvas')?.requestPointerLock(); this._locked = true; }
    unlockCursor() { document.exitPointerLock?.(); this._locked = false; }
    get cursorLocked() { return this._locked; }

    anyKey()     { return this._keys.size > 0 && [...this._keys.values()].some(v => v); }
    anyKeyDown() { return this._keysDown.size > 0; }
}

export const Input = new UWPjsInput(window);
