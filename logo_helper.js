// logo_helper.js — basketbol ve tenis backend dosyalarının yanına koy.
// Logoları kendi GitHub reposundan verir. Repoda yoksa orijinal linki döndürür.
const fs = require('fs');

const GITHUB_USER = "elfcrzgr";
const REPO_NAME = "macsaati-backend";
const RAW = `https://raw.githubusercontent.com/${GITHUB_USER}/${REPO_NAME}/main`;

let nbaIds = {}, otherIds = {}, flagCodes = {};
const missing = new Set();

const norm = s => String(s || "").toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();

function buildMap(obj) {
    const m = new Map();
    for (const [k, v] of Object.entries(obj || {})) m.set(norm(k), v);
    return m;
}
let nbaMap = new Map(), otherMap = new Map();

async function fetchJson(path, cacheFile) {
    try {
        const r = await fetch(`${RAW}/${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
        if (r.ok) {
            const j = await r.json();
            fs.writeFileSync(cacheFile, JSON.stringify(j));
            return j;
        }
    } catch (e) {}
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { return null; }
}

// Backend başlarken ve döngüde (örn. yayıncı dosyasıyla birlikte) çağır
async function loadLogoMaps() {
    const t = await fetchJson('basketball/team_ids.json', 'team_ids.cache.json');
    if (t) { nbaMap = buildMap(t.nba); otherMap = buildMap(t.other); }
    const f = await fetchJson('tennis/flag_codes.json', 'flag_codes.cache.json');
    if (f) flagCodes = f;
}

const STOP = new Set(['bc','kk','bk','fc','sk','cb','bbc','basket','basketball','basketbol','baloncesto',
    'pallacanestro','club','spor','sc','the','of','de','la']);
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t));

function lookup(map, name) {
    const n = norm(name);
    if (!n) return null;
    if (map.has(n)) return map.get(n);                       // birebir eşleşme
    const nt = tokens(name);
    if (nt.length === 0) return null;
    const nset = new Set(nt);
    let best = null, bestScore = 0;
    for (const [k, v] of map) {
        const kt = tokens(k);
        if (kt.length === 0) continue;
        const kset = new Set(kt);
        // 1) kayıtlı adın tüm kelimeleri gelen adda var (sponsor eklenmiş olabilir)
        if (kt.every(t => nset.has(t)) && (kt.length >= 2 || kt[0].length >= 5)) {
            if (kt.length > bestScore) { best = v; bestScore = kt.length; }
        }
        // 2) gelen adın tüm kelimeleri kayıtlı adda var (kısa yazılmış olabilir)
        else if (nt.every(t => kset.has(t)) && (nt.length >= 2 || nt[0].length >= 7)) {
            if (nt.length > bestScore) { best = v; bestScore = nt.length; }
        }
    }
    return best;
}

// Basketbol: takım adı -> repo logosu
function teamLogo(teamName, isNba, originalUrl) {
    const id = lookup(isNba ? nbaMap : otherMap, teamName);
    if (!id) {
        const key = (isNba ? 'NBA:' : '') + teamName;
        if (!missing.has(key)) {
            missing.add(key);
            console.log(`🖼️ [LOGO EKSİK] "${teamName}"${isNba ? ' (NBA/WNBA)' : ''} -> team_ids.json'a ekle`);
        }
        return originalUrl || "";
    }
    return `${RAW}/basketball/logos/${isNba ? 'NBA/' : ''}${id}.png`;
}

// Tenis: ESPN bayrak linki -> repo bayrağı (örn. .../countries/500/tur.png -> tr.png)
function flagLogo(espnUrl) {
    const m = String(espnUrl || "").match(/\/([a-z-]+)\.(?:png|svg)(?:\?.*)?$/i);
    const iso2 = m ? flagCodes[m[1].toLowerCase()] : null;
    if (!iso2) {
        if (espnUrl && !missing.has('FLAG:' + espnUrl)) {
            missing.add('FLAG:' + espnUrl);
            console.log(`🏳️ [BAYRAK EKSİK] ${espnUrl} -> flag_codes.json'a ekle`);
        }
        return espnUrl;
    }
    return `${RAW}/tennis/logos/${iso2}.png`;
}

module.exports = { loadLogoMaps, teamLogo, flagLogo };
