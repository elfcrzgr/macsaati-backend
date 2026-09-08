const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const URL = 'https://personel.meb.gov.tr/www/haberler/kategori/1';
const BOT_TOKEN = '8579384311:AAE2JQHf7bf_geJv8jKIzRVrn6beyTdgJEU'; 
const CHAT_ID = '1168053894'; 
const DOSYA = 'son_duyuru.txt';

async function mebKontrol() {
    try {
        const { data } = await axios.get(URL, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        const $ = cheerio.load(data);
        
        // Sitedeki ilk haberin başlığını ve linkini alıyoruz
        const ilkHaber = $('#icerik ul li a').first(); 
        const baslik = ilkHaber.text().trim();
        const link = ilkHaber.attr('href');
        
        if (!baslik) return;

        const tamLink = link.startsWith('http') ? link : `https://personel.meb.gov.tr${link}`;
        const mevcutDuyuru = `${baslik} - ${tamLink}`;

        let oncekiDuyuru = '';
        if (fs.existsSync(DOSYA)) {
            oncekiDuyuru = fs.readFileSync(DOSYA, 'utf-8');
        }

        if (mevcutDuyuru !== oncekiDuyuru) {
            const mesaj = `🚨 *Yeni MEB Personel Duyurusu:*\n\n[${baslik}](${tamLink})`;
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: mesaj,
                parse_mode: 'Markdown'
            });
            
            fs.writeFileSync(DOSYA, mevcutDuyuru);
            console.log("Yeni duyuru bulundu ve Telegram'a gönderildi.");
        } else {
            console.log("Sitede yeni bir duyuru yok.");
        }

    } catch (error) {
        console.error("Bir hata oluştu:", error.message);
    }
}

mebKontrol();
