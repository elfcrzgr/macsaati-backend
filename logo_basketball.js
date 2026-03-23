const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_basketball.json');
const LOGOS_BASE_DIR = path.join(__dirname, 'basketball', 'logos');
const LOGOS_NBA_DIR = path.join(__dirname, 'basketball', 'logos', 'NBA');

if (!fs.existsSync(LOGOS_BASE_DIR)) fs.mkdirSync(LOGOS_BASE_DIR, { recursive: true });
if (!fs.existsSync(LOGOS_NBA_DIR)) fs.mkdirSync(LOGOS_NBA_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) return console.error("❌ JSON bulunamadı.");

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const teamsToProcess = new Map();

    json.matches.forEach(m => {
        // ÇİFT KONTROL: Turnuva adı NBA mi? VEYA URL'de NBA/ geçiyor mu?
        const isNba = (m.tournament === "NBA" || m.homeTeam.logo.includes("/NBA/"));
        
        const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        
        teamsToProcess.set(hId, { name: m.homeTeam.name, isNba });
        teamsToProcess.set(aId, { name: m.awayTeam.name, isNba });
    });

    const missing = [];
    teamsToProcess.forEach((info, id) => {
        const targetDir = info.isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR;
        if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
            missing.push({ id, ...info });
        }
    });

    console.log(`🔍 Toplam ${teamsToProcess.size} takım tarandı.`);
    if (missing.length === 0) {
        console.log(`🎉 Harika! Tüm logolar KENDİ KLASÖRLERİNDE (NBA dahil) mevcut.`);
        return;
    }

    console.log(`⚠️ ${missing.length} eksik bulundu. İndiriliyor...`);
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    for (const t of missing) {
        const targetPath = path.join(t.isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${t.id}.png`);
        try {
            const res = await page.goto(`https://api.sofascore.com/api/v1/team/${t.id}/image`, { waitUntil: 'networkidle2' });
            if (res.status() === 200) {
                fs.writeFileSync(targetPath, await res.buffer());
                console.log(`✅ İndirildi: ${t.name}`);
            }
        } catch (e) { console.error(`❌ Hata: ${t.name}`); }
        await new Promise(r => setTimeout(r, 1000));
    }
    await browser.close();
    console.log("🏁 Bitti.");
}
start();