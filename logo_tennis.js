const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_tennis.json');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'tennis', 'tournament_logos');

// Klasörün oluşturulması
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON bulunamadı! Önce fetch_tennis.js çalıştırılmalı.");
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const tournamentsToProcess = new Map();

    // 1. JSON'ı tara ve turnuvaları belirle
    json.matches.forEach(m => {
        const tournamentId = m.tournamentLogo.split('/').pop().replace('.png', '');
        if (!tournamentsToProcess.has(tournamentId)) {
            tournamentsToProcess.set(tournamentId, { name: m.tournament });
        }
    });

    console.log(`\n🔍 JSON Tarandı:`);
    console.log(`   - Toplam Turnuva: ${tournamentsToProcess.size}`);

    // 2. Eksik turnuva logolarını kontrol et
    const missingTournaments = [];
    tournamentsToProcess.forEach((info, id) => {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        if (!fs.existsSync(targetPath)) {
            missingTournaments.push({ id, ...info });
        }
    });

    if (missingTournaments.length === 0) {
        console.log(`\n🎉 Harika! Tüm turnuva logoları KLASÖRDE mevcut. İşlem bitti.\n`);
        return;
    }

    console.log(`\n⚠️  ${missingTournaments.length} adet eksik turnuva logosu bulundu. İndirme başlıyor...\n`);

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    let successCount = 0;

    for (const t of missingTournaments) {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${t.id}.png`);
        try {
            const res = await page.goto(`https://api.sofascore.com/api/v1/tournament/${t.id}/image`, { waitUntil: 'networkidle2', timeout: 30000 });
            if (res.status() === 200) {
                fs.writeFileSync(targetPath, await res.buffer());
                console.log(`   ✅ [Turnuva] İndirildi: ${t.name}`);
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
    console.log(`\n🏁 TURNUVALAR BİTTİ:`);
    console.log(`   - Başarıyla Eklenen: ${successCount}`);
    console.log(`   - Toplam Eksik: ${missingTournaments.length}\n`);
}

start();