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

        // EKSİKLERİ BUL (Set kullanarak tekilleştirme yapıyoruz)
        const missingMap = new Map(); 

        json.matches.forEach(m => {
            // Takım Logoları
            if (m.homeTeam && m.homeTeam.logo) {
                const teams = [m.homeTeam, m.awayTeam];
                teams.forEach(team => {
                    const isNba = team.logo.includes("/NBA/");
                    const id = team.logo.split('/').pop().replace('.png', '');
                    const dir = isNba ? conf.dirs.nba : conf.dirs.team;
                    const finalPath = path.join(dir, `${id}.png`);
                    
                    if (dir && !fs.existsSync(finalPath)) {
                        missingMap.set(`team_${id}`, { id, type: 'team', dir, path: finalPath });
                    }
                });
            }

            // Turnuva Logoları
            const tId = m.tournamentLogo.split('/').pop().replace('.png', '');
            const tPath = path.join(conf.dirs.tournament, `${tId}.png`);
            if (!fs.existsSync(tPath)) {
                missingMap.set(`tour_${tId}`, { id: tId, type: 'tournament', dir: conf.dirs.tournament, path: tPath });
            }
        });

        const missingTasks = Array.from(missingMap.values());

        if (missingTasks.length === 0) {
            console.log(`   ✅ ${conf.name} logoları güncel.`);
            continue;
        }

        if (!browser) {
            browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            page = await browser.newPage();
            // User agent ve referer SofaScore tarafından engellenmemek için önemli
            await page.setExtraHTTPHeaders({ 'Referer': 'https://www.sofascore.com/' });
        }

        console.log(`   ⚠️ ${missingTasks.length} benzersiz eksik logo bulundu, indiriliyor...`);

        for (const item of missingTasks) {
            // Eğer dosya başka bir döngüde indiyse atla
            if (fs.existsSync(item.path)) continue;

            if (item.type === 'team') {
                try {
                    // page.goto yerine daha hızlı olan doğrudan buffer çekme denenebilir 
                    // ama yapıyı bozmamak için hızlı haliyle devam ediyoruz
                    const res = await page.goto(`https://api.sofascore.com/api/v1/team/${item.id}/image`, { waitUntil: 'load', timeout: 10000 });
                    if (res.status() === 200) {
                        fs.writeFileSync(item.path, await res.buffer());
                        console.log(`      ✅ İndirildi: Team ID ${item.id}`);
                    }
                } catch (e) { console.log(`      ❌ Hata (Team ${item.id}): ${e.message}`); }
            } else {
                const urls = [
                    `https://api.sofascore.com/api/v1/unique-tournament/${item.id}/image`,
                    `https://api.sofascore.com/api/v1/tournament/${item.id}/image`
                ];
                for (const url of urls) {
                    try {
                        const res = await page.goto(url, { waitUntil: 'load', timeout: 10000 });
                        if (res.status() === 200) {
                            const buf = await res.buffer();
                            if (buf.length > 500) { 
                                fs.writeFileSync(item.path, buf); 
                                console.log(`      ✅ İndirildi: Tournament ID ${item.id}`);
                                break; 
                            }
                        }
                    } catch (e) {}
                }
            }
            // 1 saniyelik bekleme (setTimeout) kaldırıldı! 
            // Eğer SofaScore ban atarsa buraya 100-200ms gibi çok küçük bir değer koyabilirsin.
        }
    }

    if (browser) await browser.close();
    console.log("\n🏁 Tüm logo işlemleri tamamlandı.");
}

start();
