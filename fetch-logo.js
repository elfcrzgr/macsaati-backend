const fs = require('fs');
const axios = require('axios');
const path = require('path');

async function downloadLogos() {
    const filePath = path.join(__dirname, 'matches.json');
    const logoDir = path.join(__dirname, 'logos');

    if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir);
    if (!fs.existsSync(filePath)) {
        console.log("❌ matches.json bulunamadı!");
        return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const teamIds = new Set();
    
    data.matches.forEach(m => {
        // ID'leri çekiyoruz
        const homeId = m.homeTeam.logo.split('/').pop().replace('.png', '');
        const awayId = m.awayTeam.logo.split('/').pop().replace('.png', '');
        teamIds.add(homeId);
        teamIds.add(awayId);
    });

    console.log(`⏳ ${teamIds.size} logo kontrol ediliyor...`);

    for (const id of teamIds) {
        const localPath = path.join(logoDir, `${id}.png`);
        
        // Sadece dosya yoksa VEYA dosya boşsa (0 byte) indir
        if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) continue;

        try {
            const response = await axios({
                url: `https://api.sofascore.app/api/v1/team/${id}/image`,
                method: 'GET',
                responseType: 'stream',
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.sofascore.com/'
                }
            });

            const writer = fs.createWriteStream(localPath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            console.log(`✅ Başarıyla indirildi: ${id}.png`);
        } catch (e) {
            console.log(`❌ Hata oluştu (${id}): Sunucu yanıt vermedi.`);
        }
    }
}
downloadLogos();