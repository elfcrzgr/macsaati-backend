const fs = require('fs');

// =========================================================================
// 🔥 AYARLAR (Firebase YOK — sadece yerel test)
// =========================================================================
const OUTPUT_FILE = 'test_espn_output.json';

const globalCache = new Map();

function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    if (t.unref) t.unref();
    return c.signal;
}

const getTRDate = (offset = 0) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
};

// ESPN tarih formatı: YYYYMMDD (tire yok)
function toESPNDateFormat(trDateStr) {
    return trDateStr.replace(/-/g, '');
}

// =========================================================================
// 🏀 ESPN ENTEGRASYONU — NBA & WNBA
// =========================================================================
const ESPN_LEAGUES = {
    nba: { slug: 'nba', displayName: 'NBA' },
    wnba: { slug: 'wnba', displayName: 'WNBA' }
};

async function fetchESPNDay(leagueSlug, dateStr) {
    try {
        const espnDate = toESPNDateFormat(dateStr);
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${leagueSlug}/scoreboard?dates=${espnDate}`;

        const response = await fetch(url, {
            signal: timeoutSignal(15000),
            headers: {
                "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15",
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            console.error(`❌ ESPN (${leagueSlug}) ${dateStr} -> HTTP ${response.status}`);
            return null;
        }

        const json = await response.json();
        return json?.events || [];
    } catch (e) {
        console.error(`❌ ESPN istek hatası (${leagueSlug}, ${dateStr}):`, e.message);
        return null;
    }
}

// ESPN status.type.state: "pre" | "in" | "post"
function mapESPNStatus(state) {
    if (state === 'post') return 'finished';
    if (state === 'in') return 'inprogress';
    return 'notstarted';
}

async function updateESPN(targetDates) {
    let totalAdded = 0;

    for (const [code, league] of Object.entries(ESPN_LEAGUES)) {
        console.log(`\n🔸 ESPN: ${league.displayName} taranıyor...`);

        for (const dateStr of targetDates) {
            const events = await fetchESPNDay(league.slug, dateStr);
            if (!events) continue;

            for (const event of events) {
                const comp = event.competitions?.[0];
                if (!comp) continue;

                const homeC = comp.competitors.find(c => c.homeAway === 'home');
                const awayC = comp.competitors.find(c => c.homeAway === 'away');
                if (!homeC || !awayC) continue;

                const state = comp.status?.type?.state;
                const statusType = mapESPNStatus(state);
                const hasScore = statusType !== 'notstarted';

                const eventDate = new Date(event.date); // ESPN UTC ISO döndürüyor
                const fixedDate = eventDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
                const fixedTime = eventDate.toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

                const broadcasts = comp.broadcasts?.flatMap(b => b.names || []) || [];
                const broadcaster = broadcasts.length > 0 ? broadcasts.join(' / ') : "Resmi Yayıncı Yok";

                const uniqueId = `espn_${event.id}`;

                globalCache.set(uniqueId, {
                    id: uniqueId,
                    isElite: true,
                    source: "ESPN",
                    rawState: state,
                    status: statusType,
                    fixedDate: fixedDate,
                    fixedTime: fixedTime,
                    timestamp: eventDate.getTime(),
                    broadcaster: broadcaster,
                    homeTeam: { name: homeC.team.displayName, logo: homeC.team.logo },
                    awayTeam: { name: awayC.team.displayName, logo: awayC.team.logo },
                    homeScore: hasScore ? String(homeC.score ?? "0") : "-",
                    awayScore: hasScore ? String(awayC.score ?? "0") : "-",
                    tournament: league.displayName
                });

                totalAdded++;
            }
        }
    }

    console.log(`\n🏀 [ESPN] Toplam ${totalAdded} maç işlendi (NBA + WNBA).`);
    return totalAdded;
}

// =========================================================================
// 🧪 TEST ANA FONKSİYONU
// =========================================================================
async function runTest() {
    console.log("============================================================");
    console.log("🧪 ESPN TEST BAŞLADI (Firebase'e YAZILMAYACAK, sadece yerel JSON)");
    console.log("============================================================");

    const targetDates = [getTRDate(-1), getTRDate(0), getTRDate(1), getTRDate(2)];
    console.log("\n📅 Hedef tarihler:", targetDates.join(', '));

    await updateESPN(targetDates);

    const finalMatches = Array.from(globalCache.values()).sort((a, b) => a.timestamp - b.timestamp);

    console.log(`\n============================================================`);
    console.log(`📊 SONUÇ: Toplam ${finalMatches.length} maç bulundu.`);
    console.log(`============================================================\n`);

    finalMatches.forEach(m => {
        console.log(`[${m.tournament}] [state:${m.rawState} -> ${m.status}] ${m.homeTeam.name} ${m.homeScore} - ${m.awayScore} ${m.awayTeam.name} | ${m.fixedDate} ${m.fixedTime} | 📺 ${m.broadcaster}`);
    });

    const outputData = { success: true, generatedAt: new Date().toISOString(), matches: finalMatches };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf8');
    console.log(`\n💾 Sonuçlar "${OUTPUT_FILE}" dosyasına kaydedildi. Firebase'e HİÇBİR ŞEY yazılmadı.`);
}

runTest();
