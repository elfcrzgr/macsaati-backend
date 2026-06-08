const axios = require('axios');
const fs = require('fs');

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
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

    console.log("🚀 Sitenin kaynak kodu (Next.js Hydration) doğrudan deşifre ediliyor...");

    for (const sport of sports) {
        try {
            // Sitenin yönlendirme yaptığı ana URL parametresiyle HTML'i ham olarak indiriyoruz
            const response = await axios.get(`https://www.sporekrani.com/?sport=${sport}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'tr,en-US;q=0.7,en;q=0.3'
                },
                timeout: 20000
            });

            const html = response.data;
            
            // Next.js'in sayfa içine gömdüğü devasa veri küpünü cımbızlıyoruz
            const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
            
            if (!nextDataMatch || !nextDataMatch[1]) {
                console.log(`⚠️ ${sport.toUpperCase()}: __NEXT_DATA__ şeması bulunamadı, alternatif aranıyor...`);
                continue;
            }

            const nextData = JSON.parse(nextDataMatch[1]);
            
            // Next.js state ağacından maçların ham listesini buluyoruz
            // Genellikle pageProps içinde veya query sonuçlarında olur, recursive fonksiyonla nokta atışı bulalım:
            function findMatchesArray(obj) {
                if (!obj || typeof obj !== 'object') return null;
                // Eğer nesne bir maç listesi barındırıyorsa ve içinde bildiğimiz parametreler varsa yakala
                if (Array.isArray(obj)) {
                    const hasMatchData = obj.some(item => item && (item.homeTeam || item.broadcastChannels || item.matchDate || item.sport));
                    if (hasMatchData) return obj;
                }
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        const result = findMatchesArray(obj[key]);
                        if (result) return result;
                    }
                }
                return null;
            }

            const matchesList = findMatchesArray(nextData);

            if (!matchesList || matchesList.length === 0) {
                console.log(`⚠️ ${sport.toUpperCase()}: Ham veri listesi boştur veya format değişmiştir.`);
                continue;
            }

            console.log(`🔍 ${sport.toUpperCase()}: Kaynak koddan ${matchesList.length} adet gizli veri söküldü.`);

            matchesList.forEach(item => {
                try {
                    // Sadece aktif spor dalına ait olanları işle
                    const itemSport = (item.sport?.slug || item.sport || '').toLowerCase();
                    if (itemSport !== sport) return;

                    const home = item.homeTeam?.name || item.homeTeam || '';
                    const away = item.awayTeam?.name || item.awayTeam || '';
                    let matchName = (home && away) ? `${home} - ${away}` : (item.name || '');

                    if (!matchName || matchName.length < 3) return;

                    // İptal Filtresi
                    const matchLower = matchName.toLowerCase();
                    if (matchLower.includes('iptal') || matchLower.includes('ertelendi')) return;

                    // Tarih & Saat
                    const dateRaw = item.startDate || item.matchDate;
                    if (!dateRaw) return;

                    const startDate = new Date(dateRaw);
                    const dateStr = startDate.toLocaleDateString('en-CA', { timeZone });

                    if (!allMatches[dateStr]) return;

                    const timeStr = startDate.toLocaleTimeString('tr-TR', { 
                        timeZone, 
                        hour: '2-digit', 
                        minute: '2-digit' 
                    });

                    // Yayıncı kanalları birleştir
                    let channels = [];
                    const rawChannels = item.broadcastChannels || item.channels || item.broadcastChannel;
                    if (Array.isArray(rawChannels)) {
                        channels = rawChannels.map(c => c.name || c.title || c).filter(n => n && typeof n === 'string');
                    } else if (rawChannels && typeof rawChannels === 'object') {
                        channels = [rawChannels.name || rawChannels.title];
                    } else if (item.channelName) {
                        channels = [item.channelName];
                    }

                    const channelStr = channels.length > 0 ? channels.join(' / ') : 'Spor Ekranı';

                    allMatches[dateStr].matches.push({
                        saat: timeStr,
                        spor: sport.charAt(0).toUpperCase() + sport.slice(1),
                        mac: matchName.toUpperCase().trim(),
                        yayin: channelStr
                    });
                } catch (e) {}
            });

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} çözme hatası:`, error.message);
        }
    }

    // Konsol Çıktısı Ekranı
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
    console.log("\n💾 Maç Saati veritabanı (yayinci_bilgisi.json) başarıyla kurtarıldı!");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
