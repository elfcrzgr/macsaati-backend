const axios = require('axios');
const cheerio = require('cheerio');

async function getBroadcasterData() {
    console.log("🌐 Spor Ekranı verileri çekiliyor (Termux Modu)...");
    
    try {
        const url = 'https://www.sporekrani.com/';
        // Gerçek kullanıcı gibi görünmek için Header ekliyoruz
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        const results = [];

        // Her maç satırını tara
        $('.list-group-item').each((i, element) => {
            const time = $(element).find('.saat').text().trim();
            const title = $(element).find('.mac-adi').text().trim();
            const sport = $(element).find('.spor-dali').text().trim();
            
            const channels = [];
            $(element).find('.kanallar a, .kanallar img').each((j, ch) => {
                const name = $(ch).attr('title') || $(ch).attr('alt') || $(ch).text().trim();
                if (name && !channels.includes(name)) {
                    channels.push(name);
                }
            });

            if (title && time) {
                results.push({
                    saat: time,
                    spor: sport,
                    mac: title,
                    yayin: channels.join(' / ')
                });
            }
        });

        if (results.length === 0) {
            console.log("⚠️ Veri bulunamadı. Site korumasına takılmış olabiliriz.");
        } else {
            console.log(`✅ ${results.length} yayın bilgisi bulundu.\n`);
            console.table(results.slice(0, 15)); // İlk 15 sonucu göster
        }

    } catch (error) {
        console.error("🚨 Hata oluştu:", error.message);
    }
}

getBroadcasterData();
