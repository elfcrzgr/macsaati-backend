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

// Klasörleri oluştur
configs.forEach(conf => {
    Object.values(conf.dirs).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
});

async function start() {
    console.log("🚀 Maç Saati Logo Avcısı (V2 - Stabil) Başlatıldı...\n");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const page = await browser.newPage();
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);

    // 1. ADIM: Ana sayfaya git ve çerezleri/session'ı kap
    console.log("🔑 Oturum anahtarları alınıyor...");
    try {
        await page.goto('https://www.sofascore.com', { waitUntil: 'networkidle2', timeout: 30000 });
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

            // Eksik tespiti
            matches.forEach(m => {
                const tourName = m.tournament || "";
                const isNBA = tourName.toUpperCase().includes("NBA");

                if (m.tournamentLogo) {
                    const id = m.tournamentLogo.split('/').pop().split('.')[0];
                    if (id && id !== 'default' && id !== 'null') {
                        const targetDir = conf.dirs.tournament;
                        if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
                            missing.push({ id, name: tourName, type: 'Turnuva', dir: targetDir, sport: conf.name });
                        }
                    }
                }

                const teams = [{ team: m.homeTeam }, { team: m.awayTeam }];
                teams.forEach(t => {
                    if (!t.team) return;
                    const logosToProcess = Array.isArray(t.team.logos) ? t.team.logos : [t.team.logo];
                    
                    logosToProcess.forEach(logoUrl => {
                        if (!logoUrl || typeof logoUrl !== 'string') return;
                        const id = logoUrl.split('/').pop().split('.')[0];
                        if (!id || id === 'default' || id === 'null') return;

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
                console.log(`✅ [${conf.name}] Bütün logolar güncel.`);
                continue;
            }

            console.log(`🔍 [${conf.name}] ${missing.length} eksik bulunuyor...`);

            for (const item of missing) {
                const targetPath = path.join(item.dir, `${item.id}.png`);
                const defaultPath = path.join(item.dir, 'default.png');
                
                let apiUrl = '';
                if (item.type === 'Turnuva') {
                    apiUrl = `https://www.sofascore.com/api/v1/unique-tournament/${item.id}/image`;
                } else if (item.sport === 'Tenis' && item.type === 'Logo') {
                    apiUrl = `https://www.sofascore.com/static/images/flags/${item.id.toLowerCase()}.png`;
                } else {
                    apiUrl = `https://www.sofascore.com/api/v1/team/${item.id}/image`;
                }

                try {
                    // Puppeteer yerine Axios ile indir (daha az kaynak, daha çok hız)
                    const response = await axios.get(apiUrl, {
                        responseType: 'arraybuffer',
                        timeout: 10000,
                        headers: {
                            'User-Agent': userAgent,
                            'Cookie': cookieString,
                            'Referer': 'https://www.sofascore.com/'
                        }
                    });

                    if (response.data.byteLength > 1000) {
                        fs.writeFileSync(targetPath, response.data);
                        console.log(`   ✅ [İNDİ] ${item.name}`);
                        totalDownloaded++;
                    } else {
                        throw new Error("Small Buffer");
                    }
                } catch (e) {
                    if (fs.existsSync(defaultPath)) {
                        fs.copyFileSync(defaultPath, targetPath);
                        console.log(`   ⚠️  [DEFAULT] ${item.name}`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [HATA] ${item.name}`);
                        totalFailed++;
                    }
                }
                await new Promise(r => setTimeout(r, 700)); // Hız limiti engeli için
            }
        }

        console.log(`\n📊 ÖZET: ${totalDownloaded} İndirildi, ${totalDefaulted} Default, ${totalFailed} Hata.\n`);

    } catch (err) {
        console.error("❌ Kritik Hata:", err.message);
    } finally {
        await browser.close();
    }
}

start();
