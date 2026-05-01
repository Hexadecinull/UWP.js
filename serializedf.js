const CLASSID = new Map([
    [1,'GameObject'],[4,'Transform'],[12,'Animation'],
    [20,'Camera'],[21,'Material'],[23,'MeshRenderer'],[25,'Renderer'],
    [28,'Texture2D'],[33,'MeshFilter'],[43,'Mesh'],[48,'Shader'],
    [49,'TextAsset'],[65,'BoxCollider'],[74,'AnimationClip'],
    [82,'AudioListener'],[83,'AudioClip'],[84,'AudioSource'],
    [108,'Light'],[114,'MonoBehaviour'],[115,'MonoScript'],
    [128,'Font'],[129,'PlayerSettings'],[141,'BuildSettings'],
    [142,'ResourceManager'],[150,'PreloadData'],[152,'Prefab'],
    [194,'AssetBundle'],[212,'Sprite'],[218,'RenderTexture'],
    [220,'LightmapSettings'],[221,'RenderSettings'],
    [222,'RectTransform'],[230,'CanvasRenderer'],
]);

const TEXFMT = new Map([
    [1,'Alpha8'],[2,'ARGB4444'],[3,'RGB24'],[4,'RGBA32'],[5,'ARGB32'],
    [7,'RGB565'],[9,'R16'],[10,'DXT1'],[12,'DXT5'],[13,'RGBA4444'],
    [14,'BGRA32'],[17,'RGBAHalf'],[20,'RGBAFloat'],
    [25,'BC4'],[26,'BC5'],[28,'BC6H'],[29,'BC7'],
    [34,'PVRTC_RGB2'],[35,'PVRTC_RGBA2'],[36,'PVRTC_RGB4'],[37,'PVRTC_RGBA4'],
    [38,'ETC_RGB4'],[47,'EAC_R'],[49,'EAC_RG'],
    [51,'ETC2_RGB4'],[52,'ETC2_RGBA1'],[53,'ETC2_RGBA8'],
]);

const BUILTIN = new Map([
    [0,'AABB'],[5,'AnimationClip'],[19,'AnimationCurve'],[34,'AnimationState'],
    [49,'Array'],[55,'Base'],[60,'BitField'],[69,'bitset'],[76,'bool'],
    [81,'char'],[86,'ColorRGBA'],[96,'Component'],[106,'data'],[111,'deque'],
    [117,'double'],[124,'dynamic_array'],[138,'FastPropertyName'],
    [155,'first'],[161,'float'],[167,'Font'],[172,'GameObject'],
    [183,'Generic Mono'],[196,'GradientNoise'],[210,'GUID'],
    [215,'int'],[219,'list'],[224,'long long'],[234,'map'],
    [238,'Matrix4x4f'],[249,'MdFour'],[256,'MonoBehaviour'],
    [270,'MonoManager'],[282,'NavMeshSettings'],[298,'object'],
    [305,'pair'],[310,'PPtr'],[315,'Prefab'],[322,'Quaternionf'],
    [334,'Rectf'],[340,'RectInt'],[348,'RectManager'],
    [360,'ResourceManager'],[376,'Rigidbody'],[386,'second'],
    [393,'set'],[397,'short'],[403,'size'],[408,'SInt16'],
    [415,'SInt32'],[422,'SInt64'],[429,'SInt8'],[435,'staticvector'],
    [448,'string'],[455,'Texture'],[463,'Texture2D'],[473,'Transform'],
    [483,'TypelessData'],[496,'UInt16'],[503,'UInt32'],[510,'UInt64'],
    [517,'UInt8'],[523,'unsigned int'],[536,'unsigned long long'],
    [555,'unsigned short'],[570,'vector'],[577,'Vector2f'],
    [586,'Vector3f'],[595,'Vector4f'],[604,'m_Curve'],
    [612,'m_EditorClassIdentifier'],[636,'m_EditorHideFlags'],
    [654,'m_Enabled'],[664,'m_ExtensionPtr'],[679,'m_GameObject'],
    [692,'m_Index'],[700,'m_IsArray'],[710,'m_IsStatic'],
    [721,'m_MetaFlag'],[732,'m_Name'],[739,'m_ObjectHideFlags'],
    [757,'m_PrefabInternal'],[774,'m_PrefabParentObject'],
    [795,'m_Script'],[804,'m_StaticEditorFlags'],[824,'m_Type'],
    [831,'m_Version'],[841,'Object'],[848,'Plane'],
    [854,'PPtr<Component>'],[870,'PPtr<GameObject>'],[887,'PPtr<Material>'],
    [902,'PPtr<MonoBehaviour>'],[922,'PPtr<MonoScript>'],
    [939,'PPtr<Object>'],[952,'PPtr<Prefab>'],[965,'PPtr<Sprite>'],
    [978,'PPtr<TextAsset>'],[994,'PPtr<Texture>'],
    [1008,'PPtr<Texture2D>'],[1024,'PPtr<Transform>'],
    [1040,'Prefab'],[1047,'Sprite'],[1054,'SpriteAtlas'],
    [1066,'StreamingController'],[1085,'StreamingInfo'],[1099,'string'],
]);

function resolveStr(off, localBuf) {
    if ((off >>> 0) >= 0x80000000) return BUILTIN.get(off & 0x7FFFFFFF) ?? '';
    let s = '';
    for (let i = off; i < localBuf.length && localBuf[i]; i++) s += String.fromCharCode(localBuf[i]);
    return s;
}

function parseTypeTreeBlob(u8, pos, le) {
    const view     = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const nodeCount = view.getUint32(pos, le); pos += 4;
    const strLen    = view.getUint32(pos, le); pos += 4;
    const nodes     = [];
    for (let i = 0; i < nodeCount; i++) {
        nodes.push({
            version:   view.getUint16(pos,      le),
            depth:     u8[pos + 2],
            isArray:   u8[pos + 3] !== 0,
            typeOff:   view.getUint32(pos + 4,  le),
            nameOff:   view.getUint32(pos + 8,  le),
            byteSize:  view.getInt32 (pos + 12, le),
            index:     view.getInt32 (pos + 16, le),
            metaFlags: view.getUint32(pos + 20, le),
        });
        pos += 24;
    }
    const strBuf = u8.subarray(pos, pos + strLen);
    pos += strLen;
    for (const n of nodes) {
        n.typeName  = resolveStr(n.typeOff, strBuf);
        n.fieldName = resolveStr(n.nameOff, strBuf);
    }
    return { nodes, pos };
}

function parseOldTypeTreeNode(u8, pos, le, view) {
    let typeName = '';
    while (pos < u8.length && u8[pos] !== 0) typeName += String.fromCharCode(u8[pos++]);
    pos++;
    let fieldName = '';
    while (pos < u8.length && u8[pos] !== 0) fieldName += String.fromCharCode(u8[pos++]);
    pos++;

    const byteSize  = view.getInt32 (pos, le); pos += 4;
    const index     = view.getInt32 (pos, le); pos += 4;
    const isArray   = view.getInt32 (pos, le) !== 0; pos += 4;
    const version   = view.getInt32 (pos, le); pos += 4;
    const metaFlags = view.getUint32(pos, le); pos += 4;
    const childCount= view.getInt32 (pos, le); pos += 4;

    const children = [];
    for (let c = 0; c < childCount; c++) {
        const child = parseOldTypeTreeNode(u8, pos, le, view);
        pos = child._pos;
        children.push(child);
    }
    return { typeName, fieldName, byteSize, isArray, version, metaFlags, index, children, _pos: pos };
}

function flattenOldTree(node, depth, out) {
    out.push({
        typeName:  node.typeName,
        fieldName: node.fieldName,
        byteSize:  node.byteSize,
        isArray:   node.isArray,
        metaFlags: node.metaFlags,
        depth,
    });
    for (const c of node.children) flattenOldTree(c, depth + 1, out);
    return out;
}

function a4(n) { return (n + 3) & ~3; }

function deserializeObject(objU8, nodes, le) {
    const view   = new DataView(objU8.buffer, objU8.byteOffset, objU8.byteLength);
    const maxPos = objU8.length;

    function deser(ni, p) {
        if (ni >= nodes.length) return { v: null, p, ni };
        const node = nodes[ni];

        let subtreeEnd = ni + 1;
        while (subtreeEnd < nodes.length && nodes[subtreeEnd].depth > node.depth) subtreeEnd++;

        if (node.typeName === 'string') {
            if (p + 4 > maxPos) return { v: '', p, ni: subtreeEnd };
            const slen = view.getUint32(p, le); p += 4;
            const s = slen > 0 && p + slen <= maxPos
                ? new TextDecoder().decode(objU8.subarray(p, p + slen))
                : '';
            p = a4(p + slen);
            return { v: s, p, ni: subtreeEnd };
        }

        if (node.isArray) {
            if (p + 4 > maxPos) return { v: null, p, ni: subtreeEnd };
            const count = view.getUint32(p, le); p += 4;

            const directKids = [];
            for (let k = ni + 1; k < subtreeEnd; k++) {
                if (nodes[k].depth === node.depth + 1) directKids.push(k);
            }
            const dataIdx = directKids[1];
            if (dataIdx === undefined) return { v: null, p, ni: subtreeEnd };

            const elem        = nodes[dataIdx];
            const elemHasKids = (dataIdx + 1 < subtreeEnd) && (nodes[dataIdx + 1].depth > elem.depth);

            if (!elemHasKids && !elem.isArray && elem.byteSize > 0) {
                const total = count * elem.byteSize;
                if (p + total > maxPos) return { v: null, p, ni: subtreeEnd };
                const raw = objU8.subarray(p, p + total);
                p += total;
                return { v: { raw, count, elemType: elem.typeName }, p, ni: subtreeEnd };
            }

            const arr = [];
            for (let i = 0; i < Math.min(count, 4096); i++) {
                const r = deser(dataIdx, p);
                arr.push(r.v);
                p = r.p;
            }
            return { v: arr, p, ni: subtreeEnd };
        }

        const hasKids = subtreeEnd > ni + 1;

        if (!hasKids) {
            if (node.byteSize <= 0 || p + node.byteSize > maxPos) return { v: null, p, ni: subtreeEnd };
            let v;
            switch (node.typeName) {
                case 'bool': case 'UInt8': case 'SInt8': case 'char': v = objU8[p]; break;
                case 'short': case 'SInt16':                           v = view.getInt16  (p, le); break;
                case 'unsigned short': case 'UInt16':                  v = view.getUint16 (p, le); break;
                case 'int': case 'SInt32':                             v = view.getInt32  (p, le); break;
                case 'unsigned int': case 'UInt32':                    v = view.getUint32 (p, le); break;
                case 'float':                                          v = view.getFloat32(p, le); break;
                case 'double':                                         v = view.getFloat64(p, le); break;
                case 'long long': case 'SInt64': {
                    const lo = view.getUint32(p, le), hi = view.getInt32(p + 4, le);
                    v = hi * 4294967296 + (lo >>> 0); break;
                }
                case 'unsigned long long': case 'UInt64': {
                    const lo = view.getUint32(p, le), hi = view.getUint32(p + 4, le);
                    v = hi * 4294967296 + lo; break;
                }
                default: v = objU8.slice(p, p + node.byteSize);
            }
            p += node.byteSize;
            if (node.metaFlags & 0x4000) p = a4(p);
            return { v, p, ni: subtreeEnd };
        }

        const obj = {};
        let j = ni + 1;
        while (j < subtreeEnd) {
            if (nodes[j].depth === node.depth + 1) {
                const r = deser(j, p);
                obj[nodes[j].fieldName] = r.v;
                p  = r.p;
                j  = r.ni;
            } else {
                j++;
            }
        }
        if (node.metaFlags & 0x4000) p = a4(p);
        return { v: obj, p, ni: subtreeEnd };
    }

    return deser(0, 0).v;
}

function extractRawBytes(field) {
    if (!field) return null;
    if (field instanceof Uint8Array)     return field;
    if (field.raw instanceof Uint8Array) return field.raw;
    if (field.Array?.raw instanceof Uint8Array) return field.Array.raw;
    if (field.data?.raw instanceof Uint8Array)  return field.data.raw;
    return null;
}

function extractString(field) {
    if (typeof field === 'string') return field;
    const raw = extractRawBytes(field);
    if (raw) { try { return new TextDecoder().decode(raw); } catch { return null; } }
    return null;
}

function heuristicName(u8, le) {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.length < 4) return '';
    const len = view.getUint32(0, le);
    if (len === 0 || len > 256 || len + 4 > u8.length) return '';
    try { return new TextDecoder().decode(u8.subarray(4, 4 + len)); } catch { return ''; }
}

export function parseSerializedFile(buffer, fileName) {
    const u8 = buffer instanceof Uint8Array ? buffer
             : new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);

    if (u8.length < 20) return { ok: false, error: 'Too small', objects: [], unityVersion: '', fileName: fileName ?? '' };

    const view         = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const metadataSize = view.getUint32(0,  false);
    const version      = view.getUint32(8,  false);
    let   dataOffset   = view.getUint32(12, false);

    if (version < 7 || version > 30) {
        return { ok: false, error: `Unsupported SF version ${version}`, objects: [], unityVersion: '', fileName: fileName ?? '' };
    }

    const endianByte = u8[16];
    const le         = (endianByte === 0);

    let pos = 20;

    let unityVersion = '';
    while (pos < u8.length && u8[pos] !== 0) unityVersion += String.fromCharCode(u8[pos++]);
    pos++;

    pos += 4;

    if (version >= 13) {
        const ett = u8[pos++];
        void ett;
    }

    let typeCount;
    {
        const tcLE = view.getUint32(pos, true);
        const tcBE = view.getUint32(pos, false);
        typeCount  = (tcLE > 50000) ? tcBE : tcLE;
        if (typeCount > 50000) return { ok: false, error: 'Implausible type count', objects: [], unityVersion, fileName: fileName ?? '' };
    }
    pos += 4;

    const types = [];

    for (let t = 0; t < typeCount; t++) {
        if (pos + 4 > u8.length) break;
        const classID = view.getInt32(pos, le); pos += 4;

        if (version >= 17) {
            pos++;
            pos += 2;
        } else if (version >= 13) {
            pos += 2;
        }

        if (version >= 17 && (classID < 0 || classID === 114)) pos += 16;
        else if (version >= 13 && version < 17 && classID === 114) pos += 16;

        if (version >= 13) pos += 16;

        let typeTree = null;

        if (version >= 12) {
            const r = parseTypeTreeBlob(u8, pos, le);
            typeTree = r.nodes;
            pos      = r.pos;
        } else {
            const oldRoot = parseOldTypeTreeNode(u8, pos, le, view);
            typeTree = flattenOldTree(oldRoot, 0, []);
            pos = oldRoot._pos;
        }

        types.push({ classID, typeTree });
    }

    if (version >= 7 && version <= 13) {
        pos += 4;
    }

    if (pos + 4 > u8.length) {
        return { ok: true, objects: [], unityVersion, version, fileName: fileName ?? '', typeCount: types.length, objectCount: 0 };
    }

    const objCount = view.getUint32(pos, le); pos += 4;
    if (objCount > 500000) return { ok: false, error: `Implausible object count ${objCount}`, objects: [], unityVersion, fileName: fileName ?? '' };

    const typeByClassID = new Map(types.map(t => [t.classID, t.typeTree]));

    const rawObjs = [];

    for (let o = 0; o < objCount; o++) {
        if (version >= 14 && (pos % 4 !== 0)) pos += 4 - (pos % 4);

        let pathID;
        if (version >= 14) {
            const lo = view.getUint32(pos, le), hi = view.getUint32(pos + 4, le);
            pathID = hi * 4294967296 + lo; pos += 8;
        } else {
            pathID = view.getInt32(pos, le); pos += 4;
        }

        const byteStart  = view.getUint32(pos, le); pos += 4;
        const byteSize   = view.getUint32(pos, le); pos += 4;
        const typeID     = view.getInt32 (pos, le); pos += 4;

        let classID = -1;
        if (version < 17) {
            classID = view.getInt16(pos, le); pos += 2;
            pos += 2;
        }
        if (version < 11) pos++;

        if (classID === -1) classID = typeID;
        rawObjs.push({ pathID, byteStart, byteSize, typeID, classID });
    }

    const objects = [];

    for (const obj of rawObjs.slice(0, 2000)) {
        const classID   = obj.classID;
        const className = CLASSID.get(classID) ?? `Class${classID}`;

        let typeTree = null;
        if (version < 12) {
            typeTree = typeByClassID.get(obj.classID) ?? typeByClassID.get(obj.typeID) ?? null;
        } else {
            typeTree = (obj.typeID >= 0 && obj.typeID < types.length) ? types[obj.typeID].typeTree : null;
        }

        const start = dataOffset + obj.byteStart;

        if (start < 0 || start + obj.byteSize > u8.length || obj.byteSize === 0) {
            objects.push({ classID, className, name: '?', error: 'out of bounds' });
            continue;
        }

        const slice = u8.subarray(start, start + obj.byteSize);
        const asset = { classID, className, name: '', pathID: obj.pathID };

        try {
            if (typeTree && typeTree.length > 0) {
                const d = deserializeObject(slice, typeTree, le);
                asset.name = typeof d?.m_Name === 'string' ? d.m_Name : '';

                if (classID === 28) {
                    asset.width         = d?.m_Width;
                    asset.height        = d?.m_Height;
                    asset.textureFormat = d?.m_TextureFormat;
                    asset.formatName    = TEXFMT.get(d?.m_TextureFormat) ?? `fmt${d?.m_TextureFormat}`;
                    const raw = extractRawBytes(d?.['image data']);
                    if (raw && raw.length > 0) asset.imageData = raw;

                } else if (classID === 21) {
                    const sp = d?.m_SavedProperties;
                    asset.shader        = d?.m_Shader;
                    asset.renderQueue   = d?.m_CustomRenderQueue ?? -1;
                    asset.colors        = {};
                    asset.floats        = {};
                    asset.textures      = {};
                    if (sp) {
                        const texEnvs  = sp.m_TexEnvs ?? sp.TexEnvs ?? [];
                        const floats   = sp.m_Floats   ?? sp.Floats   ?? [];
                        const colors   = sp.m_Colors   ?? sp.Colors   ?? [];
                        const extractPairs = (arr) => Array.isArray(arr) ? arr : (arr?.Array ?? []);
                        for (const pair of extractPairs(texEnvs)) {
                            const key = pair?.first ?? pair?.Key ?? pair?.[0];
                            const val = pair?.second ?? pair?.Value ?? pair?.[1];
                            if (typeof key === 'string' && val) {
                                asset.textures[key] = { texRef: val?.m_Texture ?? val?.texture, scale: val?.m_Scale, offset: val?.m_Offset };
                            }
                        }
                        for (const pair of extractPairs(floats)) {
                            const key = pair?.first ?? pair?.Key ?? pair?.[0];
                            const val = pair?.second ?? pair?.Value ?? pair?.[1];
                            if (typeof key === 'string' && typeof val === 'number') asset.floats[key] = val;
                        }
                        for (const pair of extractPairs(colors)) {
                            const key = pair?.first ?? pair?.Key ?? pair?.[0];
                            const val = pair?.second ?? pair?.Value ?? pair?.[1];
                            if (typeof key === 'string' && val) {
                                asset.colors[key] = [val.r ?? val.x ?? 1, val.g ?? val.y ?? 1, val.b ?? val.z ?? 1, val.a ?? val.w ?? 1];
                            }
                        }
                    }
                    asset.color     = asset.colors['_Color']     ?? asset.colors['_BaseColor'] ?? [1,1,1,1];
                    asset.shininess = (asset.floats['_Shininess'] ?? asset.floats['_Glossiness'] ?? 0.5) * 96;
                    asset.mainTex   = asset.textures['_MainTex']  ?? asset.textures['_BaseMap'] ?? null;

                } else if (classID === 43) {
                    asset.meshData = d;

                } else if (classID === 20) {
                    asset.m_GameObject    = d?.m_GameObject;
                    asset.fieldOfView     = d?.field_of_view ?? d?.m_FieldOfView ?? d?.fieldOfView ?? 60;
                    asset.nearClipPlane   = d?.near_clip_plane ?? d?.m_NearClipPlane ?? d?.nearClipPlane ?? 0.1;
                    asset.farClipPlane    = d?.far_clip_plane  ?? d?.m_FarClipPlane  ?? d?.farClipPlane  ?? 1000;
                    asset.backgroundColor = (() => {
                        const c = d?.m_BackGroundColor ?? d?.m_ClearColor ?? d?.backgroundColor;
                        return c ? [c.r ?? c.x ?? 0, c.g ?? c.y ?? 0, c.b ?? c.z ?? 0, c.a ?? c.w ?? 1] : null;
                    })();
                    asset.m_ClearFlags    = d?.m_ClearFlags ?? 1;
                    asset.depth           = d?.m_Depth ?? 0;

                } else if (classID === 108) {
                    asset.m_GameObject = d?.m_GameObject;
                    asset.m_Type       = d?.m_Type ?? 0;
                    asset.m_Color      = (() => {
                        const c = d?.m_Color ?? d?.color;
                        return c ? { r: c.r ?? c.x ?? 1, g: c.g ?? c.y ?? 1, b: c.b ?? c.z ?? 1, a: c.a ?? c.w ?? 1 } : null;
                    })();
                    asset.m_Intensity  = d?.m_Intensity ?? d?.intensity ?? 1;
                    asset.m_Range      = d?.m_Range     ?? d?.range     ?? 10;
                    asset.m_SpotAngle  = d?.m_SpotAngle ?? 30;

                } else if (classID === 83) {
                    asset.channels             = d?.m_Channels;
                    asset.frequency            = d?.m_Frequency;
                    asset.bitsPerSample        = d?.m_BitsPerSample;
                    asset.compressionFormat    = d?.m_CompressionFormat ?? d?.m_Type;
                    const audioRaw = extractRawBytes(d?.m_AudioData ?? d?.m_Data ?? d?.['audio data']);
                    if (audioRaw && audioRaw.length > 0) asset.m_AudioData = { raw: audioRaw };

                } else if (classID === 49) {
                    const t = extractString(d?.m_Script);
                    if (t) asset.text = t.slice(0, 4096);

                } else if (classID === 1) {
                    asset.isActive   = d?.m_IsActive;
                    asset.isStatic   = d?.m_IsStatic;
                    asset.layer      = d?.m_Layer;
                    asset.tag        = d?.m_Tag;
                    asset.components = d?.m_Component;

                } else if (classID === 4) {
                    asset.localPosition = d?.m_LocalPosition;
                    asset.localRotation = d?.m_LocalRotation;
                    asset.localScale    = d?.m_LocalScale;
                    asset.children      = d?.m_Children;
                    asset.father        = d?.m_Father;
                    asset.m_GameObject  = d?.m_GameObject;

                } else if (classID === 54) {
                    asset.m_GameObject   = d?.m_GameObject;
                    asset.mass           = d?.m_Mass ?? 1;
                    asset.drag           = d?.m_Drag ?? 0;
                    asset.angularDrag    = d?.m_AngularDrag ?? 0.05;
                    asset.useGravity     = d?.m_UseGravity ?? true;
                    asset.isKinematic    = d?.m_IsKinematic ?? false;
                    asset.constraints    = d?.m_Constraints ?? 0;
                    asset.hasRigidbody   = true;

                } else if (classID === 65) {
                    asset.m_GameObject   = d?.m_GameObject;
                    asset.isTrigger      = d?.m_IsTrigger ?? false;
                    asset.colliderType   = 'box';
                    asset.colliderParams = {
                        size:   d?.m_Size   ?? { x:1, y:1, z:1 },
                        center: d?.m_Center ?? { x:0, y:0, z:0 },
                    };

                } else if (classID === 135 || classID === 136) {
                    asset.m_GameObject   = d?.m_GameObject;
                    asset.isTrigger      = d?.m_IsTrigger ?? false;
                    asset.colliderType   = classID === 135 ? 'capsule' : 'sphere';
                    asset.colliderParams = {
                        radius:    d?.m_Radius ?? 0.5,
                        height:    d?.m_Height ?? 2,
                        center:    d?.m_Center ?? { x:0, y:0, z:0 },
                        direction: d?.m_Direction ?? 1,
                    };
                }
            } else {
                asset.name = heuristicName(slice, le);
            }
        } catch (err) {
            asset.parseError = err.message ?? String(err);
        }

        objects.push(asset);
    }

    return {
        ok: true,
        fileName:      fileName ?? '',
        version,
        unityVersion,
        typeCount:     types.length,
        objectCount:   rawObjs.length,
        truncated:     rawObjs.length > 2000,
        objects,
    };
}
