
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// Yapılandırma
const configs = [
    {
        name: 'Futbol',
        file: 'matches_football.json',
        dirs: {
            team: path.join(__dirname, 'football', 'logos'),
            tournament: path.join(__dirname, 'football', 'tournament_logos')
        }
    },
    {
        name: 'Basketbol',
        file: 'matches_basketball.json',
        dirs: {
            team: path.join(__dirname, 'basketball', 'logos'),
            nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
            tournament: path.join(__dirname, 'basketball', 'tournament_logos')
        }
    },
    {
        name: 'Tenis',
        file: 'matches_tennis.json',
        dirs: {
            tournament: path.join(__dirname, 'tennis', 'tournament_logos')
        }
    }
];

async function start() {
    console.log("🚀 Mac Saati Master Logo Güncelleyici Başlatıldı...");
    
    let browser = null;
    let page = null;

    for (const conf of configs) {
        if (!fs.existsSync(conf.file)) continue;

        const json = JSON.parse(fs.readFileSync(conf.file, 'utf8'));
        console.log(`\n🔍 ${conf.name} kontrol ediliyor...`);

        // Eksikleri Bul
        const missing = [];
        json.matches.forEach(m => {
            // Takım Logoları (Sadece Futbol ve Basketbol)
            if (m.homeTeam && m.homeTeam.logo) {
                const isNba = m.homeTeam.logo.includes("/NBA/");
                const hId = m.homeTeam.logo.split('/').pop().replace('.png', '');
                const aId = m.awayTeam.logo.split('/').pop().replace('.png', '');
                
                const teamDir = isNba ? conf.dirs.nba : conf.dirs.team;
                if (teamDir && !fs.existsSync(path.join(teamDir, `${hId}.png`))) missing.push({ id: hId, type: 'team', dir: teamDir });
                if (teamDir && !fs.existsSync(path.join(teamDir, `${aId}.png`))) missing.push({ id: aId, type: 'team', dir: teamDir });
            }

            // Turnuva Logoları (Hepsi)
            const tId = m.tournamentLogo.split('/').pop().replace('.png', '');
            if (!fs.existsSync(path.join(conf.dirs.tournament, `${tId}.png`))) {
                missing.push({ id: tId, type: 'tournament', dir: conf.dirs.tournament });
            }
        });

        if (missing.length === 0) {
            console.log(`   ✅ ${conf.name} logoları güncel.`);
            continue;
        }

        // Eğer eksik varsa tarayıcıyı BİR KEZ aç
        if (!browser) {
            browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            page = await browser.newPage();
        }

        console.log(`   ⚠️ ${missing.length} eksik logo bulundu, indiriliyor...`);

        for (const item of missing) {
            const targetPath = path.join(item.dir, `${item.id}.png`);
            
            if (item.type === 'team') {
                try {
                    const res = await page.goto(`https://api.sofascore.com/api/v1/team/${item.id}/image`, { waitUntil: 'networkidle2' });
                    if (res.status() === 200) fs.writeFileSync(targetPath, await res.buffer());
                } catch (e) {}
            } else {
                // Turnuva için Unique + Normal Fallback
                const urls = [`https://api.sofascore.com/api/v1/unique-tournament/${item.id}/image`, `https://api.sofascore.com/api/v1/tournament/${item.id}/image` ];
                for (const url of urls) {
                    try {
                        const res = await page.goto(url, { waitUntil: 'networkidle2' });
                        if (res.status() === 200) {
                            const buf = await res.buffer();
                            if (buf.length > 500) { fs.writeFileSync(targetPath, buf); break; }
                        }
                    } catch (e) {}
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (browser) await browser.close();
    console.log("\n🏁 Tüm logo işlemleri tamamlandı.");
}

start();
