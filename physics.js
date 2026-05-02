const GRAVITY = -9.81;
const SLEEP_THRESHOLD = 0.002;
const SLEEP_FRAMES    = 60;

function v3(x=0,y=0,z=0) { return {x,y,z}; }
function add3(a,b)  { return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}; }
function sub3(a,b)  { return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}; }
function scale3(v,s){ return {x:v.x*s,y:v.y*s,z:v.z*s}; }
function dot3(a,b)  { return a.x*b.x+a.y*b.y+a.z*b.z; }
function len3(v)    { return Math.sqrt(dot3(v,v)); }
function norm3(v)   { const l=len3(v); return l>1e-8?scale3(v,1/l):{x:0,y:1,z:0}; }
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

class Rigidbody {
    constructor(node) {
        this.node          = node;
        this.mass          = node.mass     ?? 1;
        this.drag          = node.drag     ?? 0;
        this.angularDrag   = node.angularDrag ?? 0.05;
        this.useGravity    = node.useGravity  ?? true;
        this.isKinematic   = node.isKinematic ?? false;
        this.freezeX       = !!(node.constraints & 0x02);
        this.freezeY       = !!(node.constraints & 0x04);
        this.freezeZ       = !!(node.constraints & 0x08);
        this.velocity      = v3();
        this.angularVelocity = v3();
        this._force        = v3();
        this._torque       = v3();
        this._sleepFrames  = 0;
        this._sleeping     = false;
    }

    addForce(f, mode='Force') {
        this._sleeping = false; this._sleepFrames = 0;
        if (mode === 'Impulse')       { this.velocity = add3(this.velocity, scale3(f, 1/this.mass)); }
        else if (mode === 'VelocityChange') { this.velocity = add3(this.velocity, f); }
        else                          { this._force = add3(this._force, f); }
    }

    addTorque(t) {
        this._sleeping = false;
        this._torque = add3(this._torque, t);
    }

    integrate(dt) {
        if (this.isKinematic || this._sleeping) return;
        const invM = 1 / this.mass;
        const grav = this.useGravity ? {x:0,y:GRAVITY*this.mass,z:0} : v3();
        const totalF = add3(this._force, grav);
        const acc = scale3(totalF, invM);
        this.velocity = add3(this.velocity, scale3(acc, dt));
        this.velocity = scale3(this.velocity, Math.max(0, 1 - this.drag * dt));
        this.angularVelocity = scale3(this.angularVelocity, Math.max(0, 1 - this.angularDrag * dt));
        if (this.freezeX) this.velocity.x = 0;
        if (this.freezeY) this.velocity.y = 0;
        if (this.freezeZ) this.velocity.z = 0;
        const pos = this.node.localPosition;
        this.node.localPosition = add3(pos, scale3(this.velocity, dt));
        this._force  = v3();
        this._torque = v3();
        const speed = len3(this.velocity);
        if (speed < SLEEP_THRESHOLD) { this._sleepFrames++; if (this._sleepFrames > SLEEP_FRAMES) this._sleeping = true; }
        else                         { this._sleepFrames = 0; }
    }

    wakeUp()  { this._sleeping = false; this._sleepFrames = 0; }
    sleep()   { this._sleeping = true; }
    get isSleeping() { return this._sleeping; }
}

class BoxCollider {
    constructor(node, size, center) {
        this.node   = node;
        this.size   = size   ?? {x:1,y:1,z:1};
        this.center = center ?? {x:0,y:0,z:0};
        this.isTrigger = node.isTrigger ?? false;
    }

    getWorldAABB() {
        const p  = this.node.localPosition;
        const s  = this.node.localScale ?? {x:1,y:1,z:1};
        const hx = (this.size.x * s.x) * 0.5;
        const hy = (this.size.y * s.y) * 0.5;
        const hz = (this.size.z * s.z) * 0.5;
        const cx = p.x + this.center.x;
        const cy = p.y + this.center.y;
        const cz = p.z + this.center.z;
        return { min:{x:cx-hx,y:cy-hy,z:cz-hz}, max:{x:cx+hx,y:cy+hy,z:cz+hz}, center:{x:cx,y:cy,z:cz} };
    }

    get type() { return 'box'; }
}

class SphereCollider {
    constructor(node, radius, center) {
        this.node   = node;
        this.radius = radius ?? 0.5;
        this.center = center ?? {x:0,y:0,z:0};
        this.isTrigger = node.isTrigger ?? false;
    }

    getWorldCenter() {
        const p = this.node.localPosition;
        return { x: p.x + this.center.x, y: p.y + this.center.y, z: p.z + this.center.z };
    }

    getWorldRadius() {
        const s = this.node.localScale ?? {x:1,y:1,z:1};
        return this.radius * Math.max(s.x, s.y, s.z);
    }

    get type() { return 'sphere'; }
}

class CapsuleCollider {
    constructor(node, radius, height, direction) {
        this.node      = node;
        this.radius    = radius    ?? 0.5;
        this.height    = height    ?? 2;
        this.direction = direction ?? 1;
        this.isTrigger = node.isTrigger ?? false;
    }

    getWorldSphere() {
        const p = this.node.localPosition;
        const s = this.node.localScale ?? {x:1,y:1,z:1};
        const r = this.radius * Math.max(s.x, s.z);
        const h = this.height * s.y * 0.5 - r;
        return { center: p, radius: r, halfHeight: Math.max(0, h) };
    }

    get type() { return 'capsule'; }
}

function aabbOverlap(a, b) {
    return a.min.x <= b.max.x && a.max.x >= b.min.x &&
           a.min.y <= b.max.y && a.max.y >= b.min.y &&
           a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function aabbSphereOverlap(aabb, center, radius) {
    const dx = Math.max(aabb.min.x - center.x, 0, center.x - aabb.max.x);
    const dy = Math.max(aabb.min.y - center.y, 0, center.y - aabb.max.y);
    const dz = Math.max(aabb.min.z - center.z, 0, center.z - aabb.max.z);
    return dx*dx + dy*dy + dz*dz <= radius*radius;
}

function sphereSphereOverlap(c1, r1, c2, r2) {
    const dx = c1.x-c2.x, dy = c1.y-c2.y, dz = c1.z-c2.z;
    return dx*dx+dy*dy+dz*dz <= (r1+r2)*(r1+r2);
}

function resolveAABB(rbA, colA, rbB, colB) {
    if (colA.isTrigger || colB.isTrigger) return null;
    const a = colA.getWorldAABB(), b = colB.getWorldAABB();
    if (!aabbOverlap(a, b)) return null;
    const dx = Math.min(a.max.x - b.min.x, b.max.x - a.min.x);
    const dy = Math.min(a.max.y - b.min.y, b.max.y - a.min.y);
    const dz = Math.min(a.max.z - b.min.z, b.max.z - a.min.z);
    let nx=0, ny=0, nz=0, pen=0;
    if (dx <= dy && dx <= dz) { pen=dx; nx=a.center.x < b.center.x ? -1 : 1; }
    else if (dy <= dx && dy <= dz) { pen=dy; ny=a.center.y < b.center.y ? -1 : 1; }
    else { pen=dz; nz=a.center.z < b.center.z ? -1 : 1; }
    return { normal:{x:nx,y:ny,z:nz}, penetration:pen };
}

function resolveSphere(rbA, colA, rbB, colB) {
    if (colA.isTrigger || colB.isTrigger) return null;
    const c1 = colA.getWorldCenter(), r1 = colA.getWorldRadius();
    const c2 = colB.getWorldCenter(), r2 = colB.getWorldRadius();
    if (!sphereSphereOverlap(c1, r1, c2, r2)) return null;
    const d = sub3(c1, c2), l = len3(d);
    const pen = r1 + r2 - l;
    const n   = l > 1e-6 ? scale3(d, 1/l) : {x:0,y:1,z:0};
    return { normal:n, penetration:pen };
}

function applyCollisionResponse(rbA, rbB, contact) {
    if (!contact) return;
    const { normal, penetration } = contact;
    const totalMass  = (rbA ? rbA.mass : Infinity) + (rbB ? rbB.mass : Infinity);
    const fracA      = rbA && !rbA.isKinematic ? (rbB ? rbB.mass / totalMass : 1) : 0;
    const fracB      = rbB && !rbB.isKinematic ? (rbA ? rbA.mass / totalMass : 1) : 0;
    if (rbA && !rbA.isKinematic) {
        rbA.node.localPosition = add3(rbA.node.localPosition, scale3(normal,  fracA * penetration));
        const vn = dot3(rbA.velocity, normal);
        if (vn < 0) rbA.velocity = add3(rbA.velocity, scale3(normal, -vn * 1.4));
        rbA.wakeUp();
    }
    if (rbB && !rbB.isKinematic) {
        rbB.node.localPosition = add3(rbB.node.localPosition, scale3(normal, -fracB * penetration));
        const vn = dot3(rbB.velocity, normal);
        if (vn > 0) rbB.velocity = add3(rbB.velocity, scale3(normal, -vn * 1.4));
        rbB.wakeUp();
    }
}

function raycastAABB(origin, dir, aabb) {
    let tmin = -Infinity, tmax = Infinity;
    for (const ax of ['x','y','z']) {
        const inv = 1 / dir[ax];
        let t1 = (aabb.min[ax] - origin[ax]) * inv;
        let t2 = (aabb.max[ax] - origin[ax]) * inv;
        if (t1 > t2) { const tmp=t1; t1=t2; t2=tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmax < 0 || tmin > tmax) return null;
    }
    return tmin >= 0 ? tmin : tmax >= 0 ? tmax : null;
}

function raycastSphere(origin, dir, center, radius) {
    const oc = sub3(origin, center);
    const a  = dot3(dir, dir);
    const b  = 2 * dot3(oc, dir);
    const c  = dot3(oc, oc) - radius * radius;
    const disc = b*b - 4*a*c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2*a);
    return t >= 0 ? t : null;
}

export class UWPjsPhysics {
    constructor() {
        this._rigidbodies = new Map();
        this._colliders   = new Map();
        this._pairs       = [];
        this._gravity     = {x:0, y:GRAVITY, z:0};
        this._onCollision = new Map();
        this._onTrigger   = new Map();
        this._time        = 0;
    }

    addRigidbody(node) {
        const rb = new Rigidbody(node);
        this._rigidbodies.set(node.pathID, rb);
        return rb;
    }

    addCollider(node, type, params) {
        let col;
        if (type === 'box')    col = new BoxCollider(node, params?.size, params?.center);
        else if (type === 'sphere') col = new SphereCollider(node, params?.radius, params?.center);
        else if (type === 'capsule') col = new CapsuleCollider(node, params?.radius, params?.height, params?.direction);
        else return null;
        if (!this._colliders.has(node.pathID)) this._colliders.set(node.pathID, []);
        this._colliders.get(node.pathID).push(col);
        return col;
    }

    buildFromScene(sceneNodes) {
        this._rigidbodies.clear();
        this._colliders.clear();
        for (const node of sceneNodes) {
            if (node.hasRigidbody) this.addRigidbody(node);
            if (node.colliderType) this.addCollider(node, node.colliderType, node.colliderParams ?? {});
            else if (node.meshName) {
                const meshLower = node.meshName.toLowerCase();
                const type = meshLower === 'sphere' ? 'sphere'
                           : meshLower.includes('capsule') ? 'capsule'
                           : 'box';
                this.addCollider(node, type, {});
            }
        }
        console.log(`[Physics] Built — ${this._rigidbodies.size} RBs, ${this._colliders.size} collider nodes`);
    }

    onCollisionEnter(pathID, fn) {
        this._onCollision.set(pathID, fn);
    }

    onTriggerEnter(pathID, fn) {
        this._onTrigger.set(pathID, fn);
    }

    step(dt) {
        this._time += dt;
        const clampedDT = Math.min(dt, 0.05);

        for (const rb of this._rigidbodies.values()) {
            rb.integrate(clampedDT);
        }

        const colEntries = [...this._colliders.entries()];
        for (let i = 0; i < colEntries.length; i++) {
            const [idA, colsA] = colEntries[i];
            for (let j = i+1; j < colEntries.length; j++) {
                const [idB, colsB] = colEntries[j];
                const rbA = this._rigidbodies.get(idA) ?? null;
                const rbB = this._rigidbodies.get(idB) ?? null;
                if (!rbA && !rbB) continue;

                for (const colA of colsA) {
                    for (const colB of colsB) {
                        let contact = null;
                        if (colA.type === 'box'    && colB.type === 'box')    contact = resolveAABB(rbA, colA, rbB, colB);
                        else if (colA.type === 'sphere' && colB.type === 'sphere') contact = resolveSphere(rbA, colA, rbB, colB);
                        else if (colA.type === 'box'    && colB.type === 'sphere') {
                            const aabb = colA.getWorldAABB();
                            const c    = colB.getWorldCenter(), r = colB.getWorldRadius();
                            if (aabbSphereOverlap(aabb, c, r)) contact = { normal:{x:0,y:1,z:0}, penetration:r*0.5 };
                        }
                        else if (colA.type === 'sphere' && colB.type === 'box') {
                            const aabb = colB.getWorldAABB();
                            const c    = colA.getWorldCenter(), r = colA.getWorldRadius();
                            if (aabbSphereOverlap(aabb, c, r)) contact = { normal:{x:0,y:-1,z:0}, penetration:r*0.5 };
                        }
                        if (contact) {
                            if (!colA.isTrigger && !colB.isTrigger) {
                                applyCollisionResponse(rbA, rbB, contact);
                            }
                            this._onCollision.get(idA)?.(colB.node, contact);
                            this._onCollision.get(idB)?.(colA.node, contact);
                            if (colA.isTrigger || colB.isTrigger) {
                                this._onTrigger.get(idA)?.(colB.node);
                                this._onTrigger.get(idB)?.(colA.node);
                            }
                        }
                    }
                }
            }
        }
    }

    raycast(origin, direction, maxDist = Infinity) {
        const dir = norm3(direction);
        let closest = null, closestT = maxDist;

        for (const [id, cols] of this._colliders) {
            for (const col of cols) {
                let t = null;
                if (col.type === 'box') {
                    t = raycastAABB(origin, dir, col.getWorldAABB());
                } else if (col.type === 'sphere') {
                    t = raycastSphere(origin, dir, col.getWorldCenter(), col.getWorldRadius());
                }
                if (t !== null && t < closestT) {
                    closestT = t;
                    const hitPoint = add3(origin, scale3(dir, t));
                    closest = { node: col.node, point: hitPoint, distance: t, collider: col };
                }
            }
        }
        return closest;
    }

    getRigidbody(pathID) { return this._rigidbodies.get(pathID) ?? null; }
    getColliders(pathID) { return this._colliders.get(pathID) ?? []; }

    setGravity(g) { this._gravity = g; }

    get simulationTime() { return this._time; }
}
