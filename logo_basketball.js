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
    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON bulunamadı! Önce fetch_basketball.js çalıştırılmalı.");
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const teamsToProcess = new Map();
    let nbaCount = 0;
    let normalCount = 0;

    // 1. JSON'ı tara ve takımları klasörlerine göre grupla
    json.matches.forEach(m => {
        const isNba = m.homeTeam.logo.includes("/NBA/");
        const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');

        if (!teamsToProcess.has(hId)) {
            teamsToProcess.set(hId, { name: m.homeTeam.name, isNba });
            isNba ? nbaCount++ : normalCount++;
        }
        if (!teamsToProcess.has(aId)) {
            teamsToProcess.set(aId, { name: m.awayTeam.name, isNba });
            isNba ? nbaCount++ : normalCount++;
        }
    });

    console.log(`\n🔍 JSON Tarandı:`);
    console.log(`   - Toplam Takım: ${teamsToProcess.size}`);
    console.log(`   - NBA Takımı: ${nbaCount}`);
    console.log(`   - Diğer Ligler: ${normalCount}`);

    // 2. Eksikleri kontrol et
    const missing = [];
    teamsToProcess.forEach((info, id) => {
        const targetPath = path.join(info.isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${id}.png`);
        if (!fs.existsSync(targetPath)) {
            missing.push({ id, ...info });
        }
    });

    if (missing.length === 0) {
        console.log(`\n🎉 Harika! Tüm logolar (NBA dahil) KENDİ KLASÖRLERİNDE mevcut. İşlem bitti.\n`);
        return;
    }

    console.log(`\n⚠️  ${missing.length} adet eksik logo bulundu. İndirme başlıyor...\n`);

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    let successCount = 0;

    for (const t of missing) {
        const targetPath = path.join(t.isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${t.id}.png`);
        try {
            const res = await page.goto(`https://api.sofascore.com/api/v1/team/${t.id}/image`, { waitUntil: 'networkidle2', timeout: 30000 });
            if (res.status() === 200) {
                fs.writeFileSync(targetPath, await res.buffer());
                console.log(`   ✅ [${t.isNba ? 'NBA' : 'NORMAL'}] İndirildi: ${t.name}`);
                successCount++;
            } else {
                console.log(`   ❌ [Hata] ${t.name}: API ${res.status()}`);
            }
        } catch (e) {
            console.log(`   ❌ [Bağlantı Hatası] ${t.name}`);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    console.log(`\n🏁 İŞLEM BİTTİ:`);
    console.log(`   - Başarıyla Eklenen: ${successCount}`);
    console.log(`   - Toplam Eksik: ${missing.length}\n`);
}

start();