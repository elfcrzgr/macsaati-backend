const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadLogos() {
    const filePath = path.join(__dirname, 'matches.json');
    const logoDir = path.join(__dirname, 'logos');

    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir);
    if (!fs.existsSync(filePath)) return;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const teamIds = new Set();
    
    data.matches.forEach(m => {
        teamIds.add(m.homeTeam.logo.split('/').pop().replace('.png', ''));
        teamIds.add(m.awayTeam.logo.split('/').pop().replace('.png', ''));
    });

    console.log(`⏳ ${teamIds.size} logo kontrol ediliyor...`);

    for (const id of teamIds) {
        const localPath = path.join(logoDir, `${id}.png`);
        
        // Varsa ve boş değilse atla
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) continue;

        try {
            const response = await axios({
                url: `https://api.sofascore.app/api/v1/team/${id}/image`,
                method: 'GET',
                responseType: 'stream',
                timeout: 10000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
                    'Referer': 'https://www.sofascore.com/',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });

            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            
            console.log(`✅ Başarıyla indirildi: ${id}.png`);
            
            // 🛑 KRİTİK: Her indirme arasında 1 saniye bekle (Bloklanmamak için)
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
            console.log(`❌ Hata (${id}): ${e.message}`);
        }
    }
}
downloadLogos();