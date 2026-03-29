const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const MATCHES_FILE = path.join(__dirname, 'matches_basketball.json');
const LOGOS_BASE_DIR = path.join(__dirname, 'basketball', 'logos');
const LOGOS_NBA_DIR = path.join(__dirname, 'basketball', 'logos', 'NBA');
const TOURNAMENT_LOGOS_DIR = path.join(__dirname, 'basketball', 'tournament_logos');

if (!fs.existsSync(LOGOS_BASE_DIR)) fs.mkdirSync(LOGOS_BASE_DIR, { recursive: true });
if (!fs.existsSync(LOGOS_NBA_DIR)) fs.mkdirSync(LOGOS_NBA_DIR, { recursive: true });
if (!fs.existsSync(TOURNAMENT_LOGOS_DIR)) fs.mkdirSync(TOURNAMENT_LOGOS_DIR, { recursive: true });

async function start() {
    if (!fs.existsSync(MATCHES_FILE)) return console.error("❌ JSON bulunamadı!");

    const json = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
    const missingTeams = [];
    const missingTournaments = [];

    json.matches.forEach(m => {
        const isNba = m.homeTeam.logo.includes("/NBA/");
        const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        const tId = m.tournamentLogo.split('/').pop().replace('.png', '');

        const hPath = path.join(isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${hId}.png`);
        const aPath = path.join(isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${aId}.png`);
        const tPath = path.join(TOURNAMENT_LOGOS_DIR, `${tId}.png`);

        if (!fs.existsSync(hPath)) missingTeams.push({ id: hId, name: m.homeTeam.name, isNba });
        if (!fs.existsSync(aPath)) missingTeams.push({ id: aId, name: m.awayTeam.name, isNba });
        if (!fs.existsSync(tPath)) missingTournaments.push({ id: tId, name: m.tournament });
    });

    if (missingTeams.length === 0 && missingTournaments.length === 0) {
        return console.log("✅ Basketbol: Tüm logolar güncel.");
    }

    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    for (const t of missingTeams) {
        try {
            const res = await page.goto(`https://api.sofascore.com/api/v1/team/${t.id}/image`, { waitUntil: 'networkidle2' });
            if (res.status() === 200) fs.writeFileSync(path.join(t.isNba ? LOGOS_NBA_DIR : LOGOS_BASE_DIR, `${t.id}.png`), await res.buffer());
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }

    for (const t of missingTournaments) {
        const urls = [`https://api.sofascore.com/api/v1/unique-tournament/${t.id}/image`, `https://api.sofascore.com/api/v1/tournament/${t.id}/image` ];
        for (const url of urls) {
            try {
                const res = await page.goto(url, { waitUntil: 'networkidle2' });
                if (res.status() === 200) {
                    const b = await res.buffer();
                    if (b.length > 500) { fs.writeFileSync(path.join(TOURNAMENT_LOGOS_DIR, `${t.id}.png`), b); break; }
                }
            } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
    console.log("🏁 Basketbol işlemi bitti.");
}
start();
