const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_football.json');
const LOGOS_DIR = path.join(__dirname, 'football', 'logos');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'football', 'tournament_logos');

if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) return console.error("❌ JSON bulunamadı!");

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const missingTeams = [];
    const missingTournaments = [];

    // 1. Eksikleri Tespit Et
    const teamSet = new Map();
    const tourneySet = new Map();

    json.matches.forEach(m => {
        const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        const tId = m.tournamentLogo.split('/').pop().replace('.png', '');
        
        teamSet.set(hId, m.homeTeam.name);
        teamSet.set(aId, m.awayTeam.name);
        tourneySet.set(tId, m.tournament);
    });

    for (const [id, name] of teamSet) {
        if (!fs.existsSync(path.join(LOGOS_DIR, `${id}.png`))) missingTeams.push({ id, name });
    }
    for (const [id, name] of tourneySet) {
        if (!fs.existsSync(path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`))) missingTournaments.push({ id, name });
    }

    // 2. Eğer Eksik Yoksa Kapat
    if (missingTeams.length === 0 && missingTournaments.length === 0) {
        return console.log("✅ Futbol: Tüm logolar güncel. Tarayıcı başlatılmadı.");
    }

    console.log(`🚀 Futbol: ${missingTeams.length} takım, ${missingTournaments.length} turnuva eksik. Başlatılıyor...`);
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Takımları İndir
    for (const t of missingTeams) {
        try {
            const res = await page.goto(`https://api.sofascore.com/api/v1/team/${t.id}/image`, { waitUntil: 'networkidle2' });
            if (res.status() === 200) fs.writeFileSync(path.join(LOGOS_DIR, `${t.id}.png`), await res.buffer());
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }

    // Turnuvaları İndir (Unique + Normal Kontrolü)
    for (const t of missingTournaments) {
        const urls = [
            `https://api.sofascore.com/api/v1/unique-tournament/${t.id}/image`,
            `https://api.sofascore.com/api/v1/tournament/${t.id}/image`
        ];
        for (const url of urls) {
            try {
                const res = await page.goto(url, { waitUntil: 'networkidle2' });
                if (res.status() === 200) {
                    const buf = await res.buffer();
                    if (buf.length > 500) {
                        fs.writeFileSync(path.join(TOURNAMENT_LOGOS_DIR, `${t.id}.png`), buf);
                        break;
                    }
                }
            } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    console.log("🏁 Futbol işlemi bitti.");
}
start();
