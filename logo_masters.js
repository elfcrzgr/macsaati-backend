const fs   = require(‘fs’);
const path = require(‘path’);
const axios = require(‘axios’);
const puppeteer = require(‘puppeteer-extra’);
const StealthPlugin = require(‘puppeteer-extra-plugin-stealth’);

puppeteer.use(StealthPlugin());

// ─── Firebase ────────────────────────────────────────────────────────────────
const FIREBASE_BASE_URL =
‘https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app’;

async function fetchMatches(nodeName) {
const url = `${FIREBASE_BASE_URL}/${nodeName}.json`;
try {
const res = await axios.get(url, { timeout: 20000 });
if (!res.data) return [];
if (Array.isArray(res.data))         return res.data.filter(Boolean);
if (Array.isArray(res.data.matches)) return res.data.matches.filter(Boolean);
if (Array.isArray(res.data.events))  return res.data.events.filter(Boolean);
// key→match objesi  (Firebase push key’leri)
return Object.values(res.data).filter(v => v && typeof v === ‘object’);
} catch (e) {
console.error(`   ❌ Firebase hatası (${nodeName}): ${e.message}`);
return [];
}
}
// ─────────────────────────────────────────────────────────────────────────────

/*
Firebase maç yapısı:
{
tournament    : “UEFA Konferans Ligi”,
tournamentLogo: “https://raw.githubusercontent.com/…/football/tournament_logos/17015.png”,
homeTeam: {
name : “Crystal Palace”,
logo : “https://raw.githubusercontent.com/…/football/logos/7.png”
},
awayTeam: { … }
}

ID → URL’nin son parçasından (dosya adı, uzantısız)
Hangi klasör → URL path’inden çıkarılır (football/logos, basketball/logos/NBA, …)
*/

// GitHub raw URL’den yerel klasör yolunu çıkar
// örn: “…/football/logos/7.png” → __dirname/football/logos
function localDirFromUrl(logoUrl) {
// URL’nin “main/” sonrasını al
const after = logoUrl.split(’/main/’)[1]; // “football/logos/7.png”
if (!after) return null;
const parts = after.split(’/’);           // [“football”,“logos”,“7.png”]
parts.pop();                              // dosya adını at → [“football”,“logos”]
return path.join(__dirname, …parts);
}

// ID → Sofascore API URL’leri (fallback sıralı)
function sofascoreUrls(id, type /* ‘tournament’ | ‘team’ */) {
if (type === ‘tournament’) {
return [
`https://api.sofascore.app/api/v1/unique-tournament/${id}/image`,
`https://www.sofascore.com/api/v1/unique-tournament/${id}/image`
];
}
return [
`https://api.sofascore.app/api/v1/team/${id}/image`,
`https://www.sofascore.com/api/v1/team/${id}/image`
];
}

async function downloadImage(urls, headers) {
for (const url of urls) {
try {
const res = await axios.get(url, {
responseType: ‘arraybuffer’,
timeout: 15000,
headers
});
if (res.data.byteLength > 800) return res.data;
} catch (_) { /* sonraki URL */ }
}
return null;
}

// ─── Eksik logo toplayıcı ────────────────────────────────────────────────────
function collectMissing(matches) {
const seen    = new Set();
const missing = [];

```
function add(logoUrl, type) {
    if (!logoUrl || typeof logoUrl !== 'string') return;
    if (!logoUrl.includes('/main/')) return; // GitHub URL değilse atla

    const fileName = logoUrl.split('/').pop();       // "17015.png"
    const id       = fileName.split('.')[0];         // "17015"
    if (!id || isNaN(id)) return;

    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);

    const dir = localDirFromUrl(logoUrl);
    if (!dir) return;

    // Klasör yoksa oluştur
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `${id}.png`);
    if (!fs.existsSync(filePath)) {
        missing.push({ id, type, dir, filePath, logoUrl });
    }
}

matches.forEach(m => {
    if (!m) return;
    add(m.tournamentLogo, 'tournament');
    add(m.homeTeam?.logo, 'team');
    add(m.awayTeam?.logo, 'team');
});

return missing;
```

}

// ─── Ana akış ────────────────────────────────────────────────────────────────
const NODES = [
{ label: ‘Futbol’,    node: ‘matches_football’    },
{ label: ‘Basketbol’, node: ‘matches_basketball’  },
{ label: ‘Tenis’,     node: ‘matches_tennis’      }
// matches_f1 → atlandı
];

async function start() {
console.log(‘🚀 Maç Saati Logo Avcısı (V5 – Firebase) Başlatıldı\n’);

```
const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
await page.setUserAgent(userAgent);

try {
    console.log('🔑 Sofascore session oluşturuluyor...');
    await page.goto('https://www.sofascore.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
    });
    const cookieStr = (await page.cookies())
        .map(c => `${c.name}=${c.value}`).join('; ');

    const headers = {
        'User-Agent':      userAgent,
        'Cookie':          cookieStr,
        'Referer':         'https://www.sofascore.com/',
        'Cache-Control':   'no-cache',
        'Accept':          'image/png,image/webp,image/*,*/*',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
    };

    let totalDownloaded = 0, totalDefaulted = 0, totalFailed = 0;

    for (const { label, node } of NODES) {
        console.log(`\n━━━ ${label} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   📡 Firebase: ${node}`);

        const matches = await fetchMatches(node);
        if (!matches.length) {
            console.log('   ⚠️  Maç bulunamadı, atlanıyor.');
            continue;
        }
        console.log(`   📋 ${matches.length} maç alındı.`);

        const missing = collectMissing(matches);

        if (!missing.length) {
            console.log('   ✅ Tüm logolar mevcut.');
            continue;
        }

        console.log(`   🔍 ${missing.length} eksik logo indiriliyor...\n`);

        for (const item of missing) {
            const defaultPath = path.join(item.dir, 'default.png');
            const data = await downloadImage(sofascoreUrls(item.id, item.type), headers);

            if (data) {
                fs.writeFileSync(item.filePath, data);
                console.log(`      ✅ [OK]  ${item.type === 'tournament' ? '🏆' : '👕'} ID:${item.id}`);
                totalDownloaded++;
            } else if (fs.existsSync(defaultPath)) {
                fs.copyFileSync(defaultPath, item.filePath);
                console.log(`      ⚠️  [DEF] ${item.type === 'tournament' ? '🏆' : '👕'} ID:${item.id}`);
                totalDefaulted++;
            } else {
                console.log(`      ❌ [ERR] ${item.type === 'tournament' ? '🏆' : '👕'} ID:${item.id}`);
                totalFailed++;
            }

            await new Promise(r => setTimeout(r, 1200));
        }
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📊 ÖZET: ✅ ${totalDownloaded} İndirildi  ⚠️  ${totalDefaulted} Varsayılan  ❌ ${totalFailed} Hata`);
    console.log(`${'═'.repeat(50)}\n`);

} catch (err) {
    console.error('❌ Kritik hata:', err.message);
    process.exit(1);
} finally {
    await browser.close();
}
```

}

start();