const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// --- DOSYA YOLLARI ---
const MATCHES_FILE = path.join(__dirname, 'matches_football.json');
const LOGOS_DIR = path.join(__dirname, 'football', 'logos');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'football', 'tournament_logos');

// Klasör kontrolleri
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    console.log("🚀 Futbol logo indirme (Akıllı ID Kontrolü) başlatıldı...");

    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON bulunamadı! Önce fetch_football.js çalıştırılmalı.");
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const teams = new Map();
    const tournaments = new Map();

    // 1. JSON'ı tara ve benzersiz ID'leri belirle
    json.matches.forEach(m => {
        // Takım ID'leri
        const homeId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const awayId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        teams.set(homeId, m.homeTeam.name);
        teams.set(awayId, m.awayTeam.name);

        // Turnuva ID'si
        const tournamentId = m.tournamentLogo.split('/').pop().replace('.png', '');
        tournaments.set(tournamentId, m.tournament);
    });

    console.log(`🔍 JSON Tarandı: ${teams.size} takım, ${tournaments.size} turnuva tespit edildi.`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    let teamCount = 0;
    let tournamentCount = 0;

    // 2. TAKIM LOGOLARI İŞLEMİ
    console.log("\n⚽ Takım logoları kontrol ediliyor...");
    for (const [id, name] of teams) {
        const filePath = path.join(LOGOS_DIR, `${id}.png`);
        if (fs.existsSync(filePath)) continue;

        console.log(`⏳ Takım İndiriliyor: ${name} (ID: ${id})`);
        const url = `https://api.sofascore.com/api/v1/team/${id}/image`;

        try {
            const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
            if (response && response.status() === 200) {
                const buffer = await response.buffer();
                if (buffer.length > 500) {
                    fs.writeFileSync(filePath, buffer);
                    console.log(`   ✅ Başarılı`);
                    teamCount++;
                }
            }
        } catch (e) { console.log(`   ❌ Hata: ${name}`); }
        await new Promise(r => setTimeout(r, 1500)); // Hafif bekleme
    }

    // 3. TURNUVA LOGOLARI İŞLEMİ (Akıllı Fallback)
    console.log("\n🏆 Turnuva logoları kontrol ediliyor...");
    for (const [id, name] of tournaments) {
        const filePath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        if (fs.existsSync(filePath)) continue;

        console.log(`⏳ Turnuva İndiriliyor: ${name} (ID: ${id})`);
        
        // Önce Unique, sonra Normal API denemesi
        const urls = [
            `https://api.sofascore.com/api/v1/unique-tournament/${id}/image`,
            `https://api.sofascore.com/api/v1/tournament/${id}/image`
        ];

        let isDone = false;
        for (const url of urls) {
            try {
                const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                if (response && response.status() === 200) {
                    const buffer = await response.buffer();
                    if (buffer.length > 500) {
                        fs.writeFileSync(filePath, buffer);
                        console.log(`   ✅ Başarılı (${url.includes('unique') ? 'Unique' : 'Normal'} API)`);
                        tournamentCount++;
                        isDone = true;
                        break;
                    }
                }
            } catch (e) {}
        }

        if (!isDone) console.log(`   ❌ Hata: Logo iki API'de de bulunamadı.`);
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
    console.log(`\n🏁 İŞLEM TAMAMLANDI:`);
    console.log(`   ✅ Yeni Takım Logosu: ${teamCount}`);
    console.log(`   ✅ Yeni Turnuva Logosu: ${tournamentCount}\n`);
}

start();
