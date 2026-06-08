const axios = require('axios');
const fs = require('fs');

async function getBroadcasterData() {
    const timeZone = 'Europe/Istanbul';
    
    // Tarihleri Hesapla
    const d = new Date();
    const yesterday = new Date(d); yesterday.setDate(d.getDate() - 1);
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    const nextDay = new Date(d); nextDay.setDate(d.getDate() + 2);
    
    const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone });
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    const nextDayStr = nextDay.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [yesterdayStr]: { title: `📅 DÜN (${yesterday.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [nextDayStr]: { title: `📅 ERTESİ GÜN (${nextDay.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };

    console.log("🚀 Spor Ekranı API'sine doğrudan bağlanılıyor (Tarayıcısız mod)...");

    try {
        // Sitenin tüm spor datalarını bizzat beslediği ham JSON uç noktası
        const response = await axios.get('https://www.sporekrani.com/api/matches/home', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://www.sporekrani.com/'
            },
            timeout: 15000
        });

        const entries = response.data;

        if (!entries || !Array.isArray(entries)) {
            throw new Error("API'den geçersiz veya boş veri döndü.");
        }

        console.log(`🔍 Toplam ${entries.length} adet ham veri başarıyla indirildi. İşleniyor...`);

        entries.forEach(entry => {
            // Sadece bizim istediğimiz spor dallarını filtrele
            const sportSlug = (entry.sport?.slug || entry.sport || '').toLowerCase();
            if (!['futbol', 'basketbol', 'tenis'].includes(sportSlug)) return;

            const sportName = sportSlug.charAt(0).toUpperCase() + sportSlug.slice(1);

            // Maç Adı (Ev Sahibi - Deplasman)
            const home = entry.homeTeam?.name || '';
            const away = entry.awayTeam?.name || '';
            let matchName = (home && away) ? `${home} - ${away}` : (entry.name || '');

            if (!matchName || matchName.length < 3) return;

            // Kara Liste Filtresi
            const matchLower = matchName.toLowerCase();
            if (matchLower.includes('iptal') || matchLower.includes('ertelendi')) return;

            // Tarih ve Saat Ayarları
            const startDateRaw = entry.startDate || entry.matchDate;
            if (!startDateRaw) return;

            const startDate = new Date(startDateRaw);
            const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });

            // Sadece hedeflediğimiz 4 günün içindeyse ekle
            if (!allMatches[dateStr]) return;

            const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                timeZone, 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            // Yayıncı Kanal Bilgisi (Garantili Çözüm)
            let channels = [];
            if (entry.broadcastChannels && Array.isArray(entry.broadcastChannels)) {
                channels = entry.broadcastChannels.map(c => c.name).filter(n => n);
            } else if (entry.channels && Array.isArray(entry.channels)) {
                channels = entry.channels.map(c => c.name || c).filter(n => n);
            } else if (entry.channel?.name) {
                channels = [entry.channel.name];
            }

            const channelStr = channels.length > 0 ? channels.join(' / ') : 'Spor Ekranı Özel';

            allMatches[dateStr].matches.push({
                saat: timeStr,
                spor: sportName,
                mac: matchName.toUpperCase().trim(),
                yayin: channelStr
            });
        });

    } catch (error) {
        console.error(`🚨 API Bağlantı Hatası:`, error.message);
        process.exit(1);
    }

    // Konsol Tablosu Oluşturma ve Doğrulama
    [yesterdayStr, todayStr, tomorrowStr, nextDayStr].forEach(key => {
        const group = allMatches[key];
        console.log(`\n\x1b[33m${group.title}\x1b[0m`);
        
        if (group.matches.length === 0) {
            console.log("   ⚠️ Maç bulunamadı.");
        } else {
            const uniqueMatches = Array.from(new Set(group.matches.map(JSON.stringify))).map(JSON.parse);
            const sorted = uniqueMatches.sort((a, b) => a.saat.localeCompare(b.saat));
            console.table(sorted);
        }
    });

    fs.writeFileSync('yayinci_bilgisi.json', JSON.stringify(allMatches, null, 2));
    console.log("\n💾 Maç Saati için 'yayinci_bilgisi.json' sıfır hata ile kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
