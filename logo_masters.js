const fs = require(‘fs’);
const path = require(‘path’);
const axios = require(‘axios’);
const puppeteer = require(‘puppeteer-extra’);
const StealthPlugin = require(‘puppeteer-extra-plugin-stealth’);

puppeteer.use(StealthPlugin());

const FIREBASE_BASE_URL = ‘https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app’;

async function fetchMatches(nodeName) {
const url = FIREBASE_BASE_URL + ‘/’ + nodeName + ‘.json’;
console.log(’Firebase: ’ + url);
try {
const res = await axios.get(url, { timeout: 20000 });
if (!res.data) return [];
if (Array.isArray(res.data)) return res.data.filter(Boolean);
if (Array.isArray(res.data.matches)) return res.data.matches.filter(Boolean);
if (Array.isArray(res.data.events)) return res.data.events.filter(Boolean);
return Object.values(res.data).filter(function(v) { return v && typeof v === ‘object’; });
} catch (e) {
console.error(‘Firebase hatasi (’ + nodeName + ’): ’ + e.message);
return [];
}
}

// GitHub raw URL’den yerel klasor yolunu cikar
// ornek: “…/main/football/logos/7.png” -> __dirname/football/logos
function localDirFromUrl(logoUrl) {
var after = logoUrl.split(’/main/’)[1];
if (!after) return null;
var parts = after.split(’/’);
parts.pop(); // dosya adini at
return path.join.apply(path, [__dirname].concat(parts));
}

function sofascoreUrls(id, type) {
if (type === ‘tournament’) {
return [
‘https://api.sofascore.app/api/v1/unique-tournament/’ + id + ‘/image’,
‘https://www.sofascore.com/api/v1/unique-tournament/’ + id + ‘/image’
];
}
return [
‘https://api.sofascore.app/api/v1/team/’ + id + ‘/image’,
‘https://www.sofascore.com/api/v1/team/’ + id + ‘/image’
];
}

async function downloadImage(urls, headers) {
for (var i = 0; i < urls.length; i++) {
try {
var res = await axios.get(urls[i], {
responseType: ‘arraybuffer’,
timeout: 15000,
headers: headers
});
if (res.data.byteLength > 800) return res.data;
} catch (e) {
// sonraki URL’yi dene
}
}
return null;
}

function collectMissing(matches) {
var seen = new Set();
var missing = [];

```
function add(logoUrl, type) {
    if (!logoUrl || typeof logoUrl !== 'string') return;
    if (logoUrl.indexOf('/main/') === -1) return;

    var fileName = logoUrl.split('/').pop();
    var id = fileName.split('.')[0];
    if (!id || isNaN(id)) return;

    var key = type + ':' + id;
    if (seen.has(key)) return;
    seen.add(key);

    var dir = localDirFromUrl(logoUrl);
    if (!dir) return;

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    var filePath = path.join(dir, id + '.png');
    if (!fs.existsSync(filePath)) {
        missing.push({ id: id, type: type, dir: dir, filePath: filePath });
    }
}

matches.forEach(function(m) {
    if (!m) return;
    add(m.tournamentLogo, 'tournament');
    if (m.homeTeam) add(m.homeTeam.logo, 'team');
    if (m.awayTeam) add(m.awayTeam.logo, 'team');
});

return missing;
```

}

var NODES = [
{ label: ‘Futbol’,    node: ‘matches_football’   },
{ label: ‘Basketbol’, node: ‘matches_basketball’ },
{ label: ‘Tenis’,     node: ‘matches_tennis’     }
];

async function start() {
console.log(’=== Mac Saati Logo Avcisi Basladi ===\n’);

```
var browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});
var page = await browser.newPage();
var userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
await page.setUserAgent(userAgent);

try {
    console.log('Sofascore session olusturuluyor...');
    await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2', timeout: 30000 });
    var cookies = await page.cookies();
    var cookieStr = cookies.map(function(c) { return c.name + '=' + c.value; }).join('; ');

    var headers = {
        'User-Agent': userAgent,
        'Cookie': cookieStr,
        'Referer': 'https://www.sofascore.com/',
        'Cache-Control': 'no-cache',
        'Accept': 'image/png,image/webp,image/*,*/*',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
    };

    var totalDownloaded = 0;
    var totalDefaulted = 0;
    var totalFailed = 0;

    for (var i = 0; i < NODES.length; i++) {
        var label = NODES[i].label;
        var nodeName = NODES[i].node;

        console.log('\n--- ' + label + ' ---');

        var matches = await fetchMatches(nodeName);
        if (!matches.length) {
            console.log('Mac bulunamadi, atlaniyor.');
            continue;
        }
        console.log(matches.length + ' mac alindi.');

        var missing = collectMissing(matches);

        if (!missing.length) {
            console.log('Tum logolar mevcut.');
            continue;
        }

        console.log(missing.length + ' eksik logo indiriliyor...');

        for (var j = 0; j < missing.length; j++) {
            var item = missing[j];
            var defaultPath = path.join(item.dir, 'default.png');
            var data = await downloadImage(sofascoreUrls(item.id, item.type), headers);

            if (data) {
                fs.writeFileSync(item.filePath, data);
                console.log('  OK: ' + item.type + ' ID:' + item.id);
                totalDownloaded++;
            } else if (fs.existsSync(defaultPath)) {
                fs.copyFileSync(defaultPath, item.filePath);
                console.log('  DEFAULT: ' + item.type + ' ID:' + item.id);
                totalDefaulted++;
            } else {
                console.log('  ERR: ' + item.type + ' ID:' + item.id);
                totalFailed++;
            }

            await new Promise(function(r) { setTimeout(r, 1200); });
        }
    }

    console.log('\n=== OZET: ' + totalDownloaded + ' Indirildi | ' + totalDefaulted + ' Varsayilan | ' + totalFailed + ' Hata ===\n');

} catch (err) {
    console.error('Kritik hata: ' + err.message);
    process.exit(1);
} finally {
    await browser.close();
}
```

}

start();