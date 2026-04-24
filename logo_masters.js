const fs = require('fs');
const path = require('path');
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
            team: path.join(__dirname, 'tennis', 'logos') // Tenis bayrakları için
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
    console.log("🚀 Maç Saati Logo Avcısı Başlatıldı...\n");
    
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // 🛡️ KRİTİK: iMac kimliği ve Referer ayarı
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Referer': 'https://www.sofascore.com/',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8'
    });

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

            // 1. Turnuva Logosu Kontrolü
            if (m.tournamentLogo) {
                const id = m.tournamentLogo.split('/').pop().split('.')[0];
                if (id && id !== 'default' && id !== 'null') {
                    const targetDir = conf.dirs.tournament;
                    if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
                        missing.push({ id, name: tourName, type: 'Turnuva', dir: targetDir, sport: conf.name });
                    }
                }
            }

            // 2. Takım Logoları Kontrolü (Ev ve Deplasman)
            const teams = [
                { team: m.homeTeam, side: 'Ev' },
                { team: m.awayTeam, side: 'Dep' }
            ];

            teams.forEach(t => {
                if (!t.team) return;
                // logos dizisi veya tek logo kontrolü
                const logosToProcess = Array.isArray(t.team.logos) ? t.team.logos : [t.team.logo];
                
                logosToProcess.forEach(logoUrl => {
                    if (!logoUrl || typeof logoUrl !== 'string') return;
                    const id = logoUrl.split('/').pop().split('.')[0];
                    if (!id || id === 'default' || id === 'null') return;

                    // 🔥 NBA LOGIC: Takım logosu ve NBA turnuvası ise NBA klasörüne, değilse standart logos/
                    let targetDir = conf.dirs.team;
                    if (conf.name === 'Basketbol' && isNBA) {
                        targetDir = conf.dirs.nba;
                    }

                    if (!fs.existsSync(path.join(targetDir, `${id}.png`))) {
                        if (!missing.find(x => x.id === id)) {
                            missing.push({ id, name: t.team.name, type: 'Logo', dir: targetDir, sport: conf.name });
                        }
                    }
                });
            });
        });

        if (missing.length === 0) {
            console.log(`✅ [${conf.name}] Bütün logolar klasörde mevcut.`);
            continue;
        }

        console.log(`🔍 [${conf.name}] ${missing.length} adet eksik logo bulundu. İndiriliyor...`);

        for (const item of missing) {
            const targetPath = path.join(item.dir, `${item.id}.png`);
            const defaultPath = path.join(item.dir, 'default.png');
            let success = false;

            try {
                // SofaScore'un resim API'sini kullanıyoruz
                const apiUrl = item.type === 'Turnuva' 
                    ? `https://api.sofascore.app/api/v1/unique-tournament/${item.id}/image`
                    : `https://api.sofascore.app/api/v1/team/${item.id}/image`;

                const response = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                if (response && response.status() === 200) {
                    const buffer = await response.buffer();
                    // 500 byte'dan küçükse resim boştur veya hata sayfasıdır
                    if (buffer.length > 500) {
                        fs.writeFileSync(targetPath, buffer);
                        success = true;
                    }
                }

                const logLabel = `[${item.sport}] ${item.name} (${item.type})`;
                if (success) {
                    console.log(`   ✅ [İNDİ] ${logLabel}`);
                    totalDownloaded++;
                } else {
                    if (fs.existsSync(defaultPath)) {
                        fs.copyFileSync(defaultPath, targetPath);
                        console.log(`   ⚠️  [DEFAULT] ${logLabel}`);
                        totalDefaulted++;
                    } else {
                        console.log(`   ❌ [HATA] ${logLabel}`);
                        totalFailed++;
                    }
                }
            } catch (e) {
                console.log(`   ❌ [BAĞLANTI] ${item.name}`);
                totalFailed++;
            }
            // Sunucuyu yormamak ve bloklanmamak için kısa bekleme
            await new Promise(r => setTimeout(r, 500));
        }
    }

    await browser.close();
    console.log(`\n📊 ÖZET: ${totalDownloaded} İndirildi, ${totalDefaulted} Default, ${totalFailed} Hata.\n`);
}

start();