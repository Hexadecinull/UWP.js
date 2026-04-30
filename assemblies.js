const METADATA_TABLES = [
    'Module','TypeRef','TypeDef','FieldPtr','Field','MethodPtr','MethodDef',
    'ParamPtr','Param','InterfaceImpl','MemberRef','Constant','CustomAttribute',
    'FieldMarshal','DeclSecurity','ClassLayout','FieldLayout','StandAloneSig',
    'EventMap','EventPtr','Event','PropertyMap','PropertyPtr','Property',
    'MethodSemantics','MethodImpl','ModuleRef','TypeSpec','ImplMap',
    'FieldRVA','ENCLog','ENCMap','Assembly','AssemblyProcessor','AssemblyOS',
    'AssemblyRef','AssemblyRefProcessor','AssemblyRefOS','File','ExportedType',
    'ManifestResource','NestedClass','GenericParam','MethodSpec','GenericParamConstraint',
];

class PEReader {
    constructor(u8) {
        this.u8   = u8;
        this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    }

    u8At(p)  { return this.u8[p]; }
    u16(p)   { return this.view.getUint16(p, true); }
    u32(p)   { return this.view.getUint32(p, true); }
    u64(p)   { return this.view.getBigUint64 ? Number(this.view.getBigUint64(p, true)) : this.u32(p) + this.u32(p+4)*4294967296; }
    str(p,n) { return new TextDecoder().decode(this.u8.subarray(p, p+n)); }
    zstr(p)  { let s=''; while(p<this.u8.length&&this.u8[p]) s+=String.fromCharCode(this.u8[p++]); return s; }
}

function rvaToOffset(rva, sections) {
    for (const s of sections) {
        if (rva >= s.virtualAddress && rva < s.virtualAddress + s.virtualSize) {
            return rva - s.virtualAddress + s.rawOffset;
        }
    }
    return -1;
}

export function parseDotNetAssembly(buffer, name) {
    const result = {
        name:        name ?? '?',
        ok:          false,
        assemblyName:'',
        version:     '',
        typeDefs:    [],
        methodDefs:  [],
        customAttrs: [],
        error:       null,
    };

    try {
        const u8  = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
        const pe  = new PEReader(u8);

        if (pe.u16(0) !== 0x5A4D) { result.error = 'Not a PE file'; return result; }

        const peOff = pe.u32(0x3C);
        if (pe.u32(peOff) !== 0x00004550) { result.error = 'PE signature invalid'; return result; }

        const machine    = pe.u16(peOff + 4);
        const numSections= pe.u16(peOff + 6);
        const optMagic   = pe.u16(peOff + 24);
        const is64       = (optMagic === 0x20B);

        const sectionTableOff = peOff + 24 + (is64 ? 240 : 224);
        const sections = [];
        for (let i = 0; i < numSections; i++) {
            const base = sectionTableOff + i * 40;
            sections.push({
                name:           pe.str(base, 8).replace(/\0.*/, ''),
                virtualSize:    pe.u32(base + 8),
                virtualAddress: pe.u32(base + 12),
                rawSize:        pe.u32(base + 16),
                rawOffset:      pe.u32(base + 20),
            });
        }

        const cliHdrRVA = is64 ? pe.u32(peOff + 24 + 216) : pe.u32(peOff + 24 + 208);
        const cliOff    = rvaToOffset(cliHdrRVA, sections);
        if (cliOff < 0) { result.error = 'No CLI header'; return result; }

        const metaRVA  = pe.u32(cliOff + 8);
        const metaOff  = rvaToOffset(metaRVA, sections);
        if (metaOff < 0) { result.error = 'Metadata RVA not in any section'; return result; }

        if (pe.u32(metaOff) !== 0x424A5342) { result.error = 'Metadata magic invalid'; return result; }

        const versionLen  = pe.u32(metaOff + 12);
        const version     = pe.str(metaOff + 16, versionLen).replace(/\0.*/, '');
        const streamCount = pe.u16(metaOff + 16 + versionLen + 2);

        let tblOff=-1, strOff=-1, strSize=0, usOff=-1, blobOff=-1, guidOff=-1;
        let p = metaOff + 16 + versionLen + 4;

        for (let s = 0; s < streamCount; s++) {
            const off  = pe.u32(p); p += 4;
            const size = pe.u32(p); p += 4;
            let sname = '';
            while (u8[p]) sname += String.fromCharCode(u8[p++]);
            p++;
            p = (p + 3) & ~3;
            const absOff = metaOff + off;
            if      (sname === '#~' || sname === '#-') tblOff = absOff;
            else if (sname === '#Strings') { strOff = absOff; strSize = size; }
            else if (sname === '#US')      usOff   = absOff;
            else if (sname === '#Blob')    blobOff = absOff;
            else if (sname === '#GUID')    guidOff = absOff;
        }

        if (tblOff < 0 || strOff < 0) { result.error = 'Missing #~ or #Strings stream'; return result; }

        const heapSizes = pe.u8At(tblOff + 6);
        const strIdxSz  = (heapSizes & 1) ? 4 : 2;
        const guidIdxSz = (heapSizes & 2) ? 4 : 2;
        const blobIdxSz = (heapSizes & 4) ? 4 : 2;

        const validLo = pe.u32(tblOff + 8);
        const validHi = pe.u32(tblOff + 12);
        const valid   = (BigInt(validHi) << 32n) | BigInt(validLo);

        const rowCounts = new Array(64).fill(0);
        let rp = tblOff + 24;
        for (let i = 0; i < 64; i++) {
            if (valid & (1n << BigInt(i))) {
                rowCounts[i] = pe.u32(rp); rp += 4;
            }
        }

        function strAt(idx) {
            if (strOff < 0 || idx === 0) return '';
            return pe.zstr(strOff + idx);
        }

        function readIdx(size, pos) { return size === 4 ? pe.u32(pos) : pe.u16(pos); }

        function ridxSize(tbl)  { return rowCounts[tbl] > 0xFFFF ? 4 : 2; }
        function cidxSize(tbls) { return Math.max(...tbls.map(t => rowCounts[t])) > (0xFFFF >> Math.ceil(Math.log2(tbls.length+1))) ? 4 : 2; }

        const tableBase = rp;

        const TYPEDEF=2, FIELD=4, METHODDEF=6, PARAM=8, MEMBERREF=10,
              CUSTOMATTR=12, ASSEMBLY=32, ASSEMBLYREF=35;

        function tableRowSize(t) {
            switch (t) {
                case TYPEDEF:    return strIdxSz*2 + ridxSize(TYPEDEF) + ridxSize(FIELD) + ridxSize(METHODDEF);
                case FIELD:      return 2 + strIdxSz + blobIdxSz;
                case METHODDEF:  return 4 + 2 + 2 + strIdxSz + blobIdxSz + ridxSize(PARAM);
                case PARAM:      return 2 + 2 + strIdxSz;
                case MEMBERREF:  return cidxSize([TYPEDEF,1,2,6,26]) + strIdxSz + blobIdxSz;
                case CUSTOMATTR: return cidxSize([2,4,6,8,10,9,14,20,22,26,27,28,32,35,38,39,40,41,42,43,44]) + cidxSize([10,6]) + blobIdxSz;
                case ASSEMBLY:   return 4+2+2+2+2+4+blobIdxSz+strIdxSz*2;
                case ASSEMBLYREF:return 2+2+2+2+4+blobIdxSz+strIdxSz*2+blobIdxSz;
                default:         return 0;
            }
        }

        function tableOffset(t) {
            let off = tableBase;
            for (let i = 0; i < t; i++) {
                const rs = tableRowSize(i);
                if (rs > 0) off += rowCounts[i] * rs;
            }
            return off;
        }

        if (rowCounts[ASSEMBLY] > 0) {
            const asmBase = tableOffset(ASSEMBLY);
            const rs      = tableRowSize(ASSEMBLY);
            const maj = pe.u16(asmBase + 4);
            const min = pe.u16(asmBase + 6);
            const bld = pe.u16(asmBase + 8);
            const rev = pe.u16(asmBase + 10);
            const nameIdx = readIdx(strIdxSz, asmBase + 16 + blobIdxSz);
            result.assemblyName = strAt(nameIdx);
            result.version      = `${maj}.${min}.${bld}.${rev}`;
        }

        const typeDefs = [];
        if (rowCounts[TYPEDEF] > 0) {
            const tblBase = tableOffset(TYPEDEF);
            const rs      = tableRowSize(TYPEDEF);
            for (let r = 0; r < rowCounts[TYPEDEF]; r++) {
                const base    = tblBase + r * rs;
                const flags   = pe.u32(base);
                const nameIdx = readIdx(strIdxSz, base + 4);
                const nsIdx   = readIdx(strIdxSz, base + 4 + strIdxSz);
                const tname   = strAt(nameIdx);
                const ns      = strAt(nsIdx);
                typeDefs.push({
                    name:      tname,
                    namespace: ns,
                    fullName:  ns ? `${ns}.${tname}` : tname,
                    flags,
                    isPublic:  (flags & 0x07) === 1 || (flags & 0x07) === 2,
                    isAbstract:(flags & 0x80) !== 0,
                    isInterface:(flags & 0x20) !== 0,
                });
            }
        }

        const methodDefs = [];
        if (rowCounts[METHODDEF] > 0) {
            const tblBase = tableOffset(METHODDEF);
            const rs      = tableRowSize(METHODDEF);
            for (let r = 0; r < rowCounts[METHODDEF]; r++) {
                const base    = tblBase + r * rs;
                const flags   = pe.u16(base + 4);
                const nameIdx = readIdx(strIdxSz, base + 8);
                const mname   = strAt(nameIdx);
                methodDefs.push({
                    name:        mname,
                    flags,
                    isPublic:    (flags & 0x07) === 6,
                    isStatic:    (flags & 0x10) !== 0,
                    isVirtual:   (flags & 0x40) !== 0,
                    isAbstract:  (flags & 0x0400) !== 0,
                    isSpecialName:(flags & 0x0800) !== 0,
                });
            }
        }

        result.ok         = true;
        result.clrVersion = version;
        result.typeDefs   = typeDefs;
        result.methodDefs = methodDefs;
        result.typeCount  = typeDefs.length;
        result.methodCount= methodDefs.length;

        result.monoBehaviours = typeDefs.filter(t => {
            const n = t.name;
            return !t.isInterface && !t.isAbstract && n && !n.startsWith('<') && n !== 'Module';
        });

    } catch (err) {
        result.error = err.message ?? String(err);
    }

    return result;
}

export function parseAllAssemblies(files) {
    const results = [];
    for (const f of files) {
        if (!f.name.endsWith('.dll')) continue;
        const buf = f.buffer instanceof ArrayBuffer ? f.buffer : f.data?.buffer;
        if (!buf) continue;
        const r = parseDotNetAssembly(buf, f.name);
        results.push(r);
    }
    return results;
}
