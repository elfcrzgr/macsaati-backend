const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_tennis.json');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'tennis', 'tournament_logos');

if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) return console.error("❌ JSON bulunamadı!");

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const missingTournaments = [];
    const tourneyMap = new Map();

    json.matches.forEach(m => {
        const id = m.tournamentLogo.split('/').pop().replace('.png', '');
        if (!fs.existsSync(path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`))) tourneyMap.set(id, m.tournament);
    });

    if (tourneyMap.size === 0) return console.log("✅ Tenis: Tüm turnuva logoları güncel.");

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    for (const [id, name] of tourneyMap) {
        console.log(`⏳ Tenis İndiriliyor: ${name}`);
        const urls = [`https://api.sofascore.com/api/v1/unique-tournament/${id}/image`, `https://api.sofascore.com/api/v1/tournament/${id}/image` ];
        
        for (const url of urls) {
            try {
                const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                if (res.status() === 200) {
                    const buffer = await res.buffer();
                    if (buffer.length > 500) {
                        fs.writeFileSync(path.join(TOURNAMENT_LOGOS_DIR, `${id}.png`), buffer);
                        console.log(`   ✅ Başarılı: ${url.includes('unique') ? 'Unique' : 'Normal'}`);
                        break;
                    }
                }
            } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 1500));
    }

    await browser.close();
    console.log("🏁 Tenis işlemi bitti.");
}
start();
