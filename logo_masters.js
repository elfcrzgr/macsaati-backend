const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

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
            tournament: path.join(__dirname, 'tennis', 'tournament_logos'),
            team: path.join(__dirname, 'tennis', 'logos')
        }
    }
];

configs.forEach(conf => {
    Object.values(conf.dirs).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
});

async function start() {
    console.log("🚀 Maç Saati Logo Avcısı (V3) Başlatıldı...\n");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const page = await browser.newPage();
    // Windows tabanlı daha yaygın bir UA
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);

    try {
        console.log("🔑 Session oluşturuluyor...");
        await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2' });
        const cookies = await page.cookies();
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        let totalDownloaded = 0;
        let totalDefaulted = 0;
        let totalFailed = 0;

        for (const conf of configs) {
            if (!fs.existsSync(conf.file)) continue;

            const data = JSON.parse(fs.readFileSync(conf.file, 'utf8'));
            const matches = data.matches || data.events || [];
            const missing = [];

            matches.forEach(m => {
                const tourName = m.tournament || "";
                const isNBA = tourName.toUpperCase().includes("NBA");

                if (m.tournamentLogo) {
                    const id = m.tournamentLogo.split('/').pop().split('.')[0];
                    if (id && id !== 'default' && id !== 'null') {
                        const targetPath = path.join(conf.dirs.tournament, `${id}.png`);
                        if (!fs.existsSync(targetPath)) {
                            missing.push({ id, name: tourName, type: 'Turnuva', dir: conf.dirs.tournament, sport: conf.name });
                        }
                    }
                }

                const teams = [{ team: m.homeTeam }, { team: m.awayTeam }];
                teams.forEach(t => {
                    if (!t.team) return;
                    const logos = Array.isArray(t.team.logos) ? t.team.logos : [t.team.logo];
                    logos.forEach(logoUrl => {
                        if (!logoUrl || typeof logoUrl !== 'string') return;
                        const id = logoUrl.split('/').pop().split('.')[0];
                        if (!id || id === 'default' || id === 'null' || isNaN(id)) return;

                        let targetDir = (conf.name === 'Basketbol' && isNBA) ? conf.dirs.nba : conf.dirs.team;
                        if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
                            if (!missing.find(x => x.id === id)) {
                                missing.push({ id, name: t.team.name, type: 'Logo', dir: targetDir, sport: conf.name });
                            }
                        }
                    });
                });
            });

            if (missing.length === 0) {
                console.log(`✅ [${conf.name}] Güncel.`);
                continue;
            }

            console.log(`🔍 [${conf.name}] ${missing.length} eksik indiriliyor...`);

            for (const item of missing) {
                const targetPath = path.join(item.dir, `${item.id}.png`);
                const defaultPath = path.join(item.dir, 'default.png');
                
                // api.sofascore.app kullanımı genelde botlar için daha az kısıtlayıcıdır
                let apiUrl = '';
                if (item.type === 'Turnuva') {
                    apiUrl = `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image`;
                } else if (item.sport === 'Tenis' && item.type === 'Logo') {
                    apiUrl = `https://www.sofascore.com/static/images/flags/${item.id.toLowerCase()}.png`;
                } else {
                    apiUrl = `https://api.sofascore.app/api/v1/team/${item.id}/image`;
                }

                try {
                    const response = await axios.get(apiUrl, {
                        responseType: 'arraybuffer',
                        timeout: 15000,
                        headers: {
                            'User-Agent': userAgent,
                            'Cookie': cookieString,
                            'Referer': 'https://www.sofascore.com/',
                            'Cache-Control': 'no-cache'
                        }
                    });

                    if (response.data.byteLength > 800) {
                        fs.writeFileSync(targetPath, response.data);
                        console.log(`   ✅ [OK] ${item.name}`);
                        totalDownloaded++;
                    } else {
                        throw new Error(`Invalid Size: ${response.data.byteLength}`);
                    }
                } catch (e) {
                    // Hata detayını gör
                    const status = e.response ? e.response.status : 'CONN_ERR';
                    
                    if (fs.existsSync(defaultPath)) {
                        fs.copyFileSync(defaultPath, targetPath);
                        console.log(`   ⚠️  [DEF-${status}] ${item.name}`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [ERR-${status}] ${item.name}`);
                        totalFailed++;
                    }
                }
                // GitHub Actions IP bloklanmasını önlemek için bekleme süresini artırdık
                await new Promise(r => setTimeout(r, 1200));
            }
        }
        console.log(`\n📊 ÖZET: ${totalDownloaded} Başarılı, ${totalDefaulted} Varsayılan, ${totalFailed} Hata.\n`);
    } catch (err) {
        console.error("❌ Kritik:", err.message);
    } finally {
        await browser.close();
    }
}

start();
