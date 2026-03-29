const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_basketball.json');
const LOGOS_BASE_DIR = path.join(__dirname, 'basketball', 'logos');
const LOGOS_NBA_DIR = path.join(__dirname, 'basketball', 'logos', 'NBA');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'basketball', 'tournament_logos');

// Klasörlerin oluşturulması
if (!fs.existsSync(LOGOS_BASE_DIR)) fs.mkdirSync(LOGOS_BASE_DIR, { recursive: true });
if (!fs.existsSync(LOGOS_NBA_DIR)) fs.mkdirSync(LOGOS_NBA_DIR, { recursive: true });
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    console.log("🚀 Basketbol logo indirme (Akıllı ID Kontrolü) başlatıldı...");

    if (!fs.existsSync(MATCHES_FILE)) {
        return console.error("❌ JSON bulunamadı! Önce fetch_basketball.js çalıştırılmalı.");
    }

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const teamsToProcess = new Map();
    const tournamentsToProcess = new Map();

    // 1. JSON'ı tara ve benzersiz ID'leri belirle
    json.matches.forEach(m => {
        // Takımlar (NBA ayrımını koruyoruz)
        const isNba = m.homeTeam.logo.includes("/NBA/");
        const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');

        if (!teamsToProcess.has(hId)) teamsToProcess.set(hId, { name: m.homeTeam.name, isNba });
        if (!teamsToProcess.has(aId)) teamsToProcess.set(aId, { name: m.awayTeam.name, isNba });

        // Turnuvalar
        const tournamentId = m.tournamentLogo.split('/').pop().replace('.png', '');
        if (!tournamentsToProcess.has(tournamentId)) {
            tournamentsToProcess.set(tournamentId, { name: m.tournament });
        }
    });

    console.log(`🔍 JSON Tarandı: ${teamsToProcess.size} takım, ${tournamentsToProcess.size} turnuva tespit edildi.`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    let teamSuccess = 0;
    let tournamentSuccess = 0;

    // 2. TAKIM LOGOLARI İŞLEMİ (NBA klasörleme mantığı korundu)
    console.log("\n🏀 Takım logoları kontrol ediliyor...");
    for (const [id, info] of teamsToProcess) {
        const targetPath = path.join(info.isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${id}.png`);
        
        if (fs.existsSync(targetPath)) continue;

        console.log(`⏳ Takım İndiriliyor: ${info.name} (ID: ${id}) [${info.isNba ? 'NBA' : 'Normal'}]`);
        const url = `https://api.sofascore.com/api/v1/team/${id}/image`;

        try {
            const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
            if (response && response.status() === 200) {
                const buffer = await response.buffer();
                if (buffer.length > 500) {
                    fs.writeFileSync(targetPath, buffer);
                    console.log(`   ✅ Başarılı`);
                    teamSuccess++;
                }
            }
        } catch (e) { console.log(`   ❌ Hata: ${info.name}`); }
        await new Promise(r => setTimeout(r, 1500));
    }

    // 3. TURNUVA LOGOLARI İŞLEMİ (Akıllı Fallback eklendi)
    console.log("\n🏆 Turnuva logoları kontrol ediliyor...");
    for (const [id, name] of tournamentsToProcess) {
        const targetPath = path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`);
        
        if (fs.existsSync(targetPath)) continue;

        console.log(`⏳ Turnuva İndiriliyor: ${name} (ID: ${id})`);
        
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
                        fs.writeFileSync(targetPath, buffer);
                        console.log(`   ✅ Başarılı (${url.includes('unique') ? 'Unique' : 'Normal'} API)`);
                        tournamentSuccess++;
                        isDone = true;
                        break;
                    }
                }
            } catch (e) {}
        }

        if (!isDone) console.log(`   ❌ Hata: Logo iki API adresinde de bulunamadı.`);
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
    console.log(`\n🏁 İŞLEM TAMAMLANDI:`);
    console.log(`   ✅ Yeni Takım Logosu: ${teamSuccess}`);
    console.log(`   ✅ Yeni Turnuva Logosu: ${tournamentSuccess}\n`);
}

start();
