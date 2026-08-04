const puppeteer = require('puppeteer');
const fs = require('fs');

// =========================================================================
// 🔥 TAKIM ADI STANDARTLAŞTIRMA (Sofascore Formatına)
// =========================================================================
const teamNameMapping = {
    // Türkiye Ligleri
    "FENERBAHÇE": "Fenerbahçe SK",
    "FENERBAHCE": "Fenerbahçe SK",
    "GALATASARAY": "Galatasaray",
    "BESIKTAS": "Beşiktaş",
    "BEŞIKTAŞ": "Beşiktaş",
    "TRABZONSPOR": "Trabzonspor",
    "BASAKSEHIR": "Başakşehir",
    "BAŞAKŞEHIR": "Başakşehir",
    "ISTANBUL BASAKSEHIR": "Başakşehir",
    "İSTANBUL BAŞAKŞEHIR": "Başakşehir",
    "SIVASSPOR": "Sivasspor",
    "KONYASPOR": "Konyaspor",
    "ANTALYASPOR": "Antalyaspor",
    "ALANYASPOR": "Alanyaspor",
    "KAYSERISPOR": "Kayserispor",
    "RIZESPOR": "Rizespor",
    "KASIMPASA": "Kasımpaşa",
    "KASIMPASA": "Kasımpaşa",
    "ISTANBULSPOR": "İstanbulspor",
    "GÖZTEPE": "Göztepe",
    "ALTAY": "Altay",
    "ERZURUMSPOR": "Erzurumspor",
    "ERZURUMSPOR FK": "Erzurumspor",
    "ADANA DEMIRSPOR": "Adana Demirspor",
    "GAZIANTEP FK": "Gaziantep FK",
    "GAZIŞEHIR GAZIANTEP": "Gaziantep FK",
    
    // Premier League
    "REAL MADRID": "Real Madrid",
    "BARCELONA": "Barcelona",
    "MANCHESTER UNITED": "Manchester United",
    "MANCHESTER CITY": "Manchester City",
    "ARSENAL": "Arsenal",
    "CHELSEA": "Chelsea",
    "LIVERPOOL": "Liverpool",
    "TOTTENHAM": "Tottenham Hotspur",
    "TOTTENHAM HOTSPUR": "Tottenham Hotspur",
    "NEWCASTLE UNITED": "Newcastle United",
    "NEWCASTLE": "Newcastle United",
    "ASTON VILLA": "Aston Villa",
    "BRIGHTON": "Brighton",
    "BRIGHTON HOVE ALBION": "Brighton",
    "CRYSTAL PALACE": "Crystal Palace",
    "EVERTON": "Everton",
    "FULHAM": "Fulham",
    "IPSWICH TOWN": "Ipswich Town",
    "IPSWICH": "Ipswich Town",
    "LEICESTER CITY": "Leicester City",
    "LEICESTER": "Leicester City",
    "MANCHESTER": "Manchester United",
    "NOTTINGHAM FOREST": "Nottingham Forest",
    "NOTTINGHAM": "Nottingham Forest",
    "BRENTFORD": "Brentford",
    "WEST HAM UNITED": "West Ham United",
    "WEST HAM": "West Ham United",
    "WOLVERHAMPTON": "Wolverhampton Wanderers",
    "WOLVERHAMPTON WANDERERS": "Wolverhampton Wanderers",
    "BOURNEMOUTH": "Bournemouth",
    "SOUTHAMPTON": "Southampton",
    "LUTON TOWN": "Luton Town",
    "LUTON": "Luton Town",
    "SHEFFIELD UNITED": "Sheffield United",
    "SHEFFIELD": "Sheffield United",
    "BURNLEY": "Burnley",
    "LEEDS UNITED": "Leeds United",
    "LEEDS": "Leeds United",

    // La Liga
    "ATLETICO MADRID": "Atletico Madrid",
    "ATLÉTICO MADRID": "Atletico Madrid",
    "REAL BETIS": "Real Betis",
    "BETIS": "Real Betis",
    "SEVILLA": "Sevilla",
    "SEVILLE": "Sevilla",
    "VALENCIA": "Valencia",
    "VILLARREAL": "Villarreal",
    "REAL SOCIEDAD": "Real Sociedad",
    "SOCIEDAD": "Real Sociedad",
    "ATHLETIC BILBAO": "Athletic Bilbao",
    "ATHLETIC": "Athletic Bilbao",
    "MALLORCA": "Mallorca",
    "LEGANES": "Leganes",
    "RAYO VALLECANO": "Rayo Vallecano",
    "RAYO": "Rayo Vallecano",
    "OSASUNA": "Osasuna",
    "GETAFE": "Getafe",
    "CELTA VIGO": "Celta Vigo",
    "CELTA": "Celta Vigo",
    "ALMERIA": "Almeria",
    "ALMERÍA": "Almeria",

    // Serie A
    "JUVENTUS": "Juventus",
    "AC MILAN": "Milan",
    "AC-MILAN": "Milan",
    "MILAN": "Milan",
    "INTER": "Inter",
    "INTER MILAN": "Inter",
    "ROMA": "Roma",
    "AS ROMA": "Roma",
    "LAZIO": "Lazio",
    "NAPOLI": "Napoli",
    "ATALANTA": "Atalanta",
    "FIORENTINA": "Fiorentina",
    "TORINO": "Torino",
    "GENOA": "Genoa",
    "MONZA": "Monza",
    "CAGLIARI": "Cagliari",
    "VENEZIA": "Venezia",
    "LECCE": "Lecce",
    "SALERNITANA": "Salernitana",
    "SASSUOLO": "Sassuolo",
    "HELLAS VERONA": "Hellas Verona",
    "VERONA": "Hellas Verona",
    "PARMA": "Parma",
    "BOLOGNA": "Bologna",

    // Ligue 1
    "PARIS SAINT-GERMAIN": "Paris Saint-Germain",
    "PARIS SG": "Paris Saint-Germain",
    "PSG": "Paris Saint-Germain",
    "OLYMPIQUE LYON": "Olympique Lyon",
    "LYON": "Olympique Lyon",
    "OLYMPIQUE MARSEILLE": "Marseille",
    "MARSEILLE": "Marseille",
    "OM": "Marseille",
    "AS MONACO": "Monaco",
    "MONACO": "Monaco",
    "LILLE": "Lille",
    "LOSC LILLE": "Lille",
    "NICE": "Nice",
    "OGC NICE": "Nice",
    "RENNES": "Rennes",
    "STADE RENNAIS": "Rennes",
    "STRASBOURG": "Strasbourg",
    "RC STRASBOURG": "Strasbourg",
    "BREST": "Brest",
    "STADE BREST": "Brest",
    "STADE BRIOCHIN": "Brest",
    "ANGERS": "Angers",
    "SCO ANGERS": "Angers",
    "MONTPELLIER": "Montpellier",
    "MONTPELLIER HSC": "Montpellier",
    "NANTES": "Nantes",
    "FC NANTES": "Nantes",
    "TOULOUSE": "Toulouse",
    "TFC": "Toulouse",
    "LENS": "Lens",
    "RC LENS": "Lens",

    // Bundesliga
    "BAYERN MÜNCHEN": "Bayern Munich",
    "BAYERN MUNCHEN": "Bayern Munich",
    "BAYERN": "Bayern Munich",
    "BORUSSIA DORTMUND": "Borussia Dortmund",
    "DORTMUND": "Borussia Dortmund",
    "BVB": "Borussia Dortmund",
    "BORUSSIA MÖNCHENGLADBACH": "Borussia Monchengladbach",
    "BORUSSIA MÖNCHEN": "Borussia Monchengladbach",
    "MÖNCHENGLADBACH": "Borussia Monchengladbach",
    "GLADBACH": "Borussia Monchengladbach",
    "BAYER LEVERKUSEN": "Bayer Leverkusen",
    "LEVERKUSEN": "Bayer Leverkusen",
    "RB LEIPZIG": "RB Leipzig",
    "LEIPZIG": "RB Leipzig",
    "SCHALKE 04": "FC Schalke 04",
    "SCHALKE": "FC Schalke 04",
    "MAINZ 05": "1. FSV Mainz 05",
    "MAINZ": "1. FSV Mainz 05",
    "HOFFENHEIM": "TSG Hoffenheim",
    "AUGSBURG": "FC Augsburg",
    "FCA": "FC Augsburg",
    "EINTRACHT FRANKFURT": "Eintracht Frankfurt",
    "FRANKFURT": "Eintracht Frankfurt",
    "UNION BERLIN": "Union Berlin",
    "BERLIN": "Union Berlin",
    "HERTHA BERLIN": "Hertha Berlin",
    "HERTHA": "Hertha Berlin",
    "FREIBURG": "SC Freiburg",
    "STUTTART": "VfB Stuttgart",
    "STUTTGART": "VfB Stuttgart",
    "HAMBURG": "Hamburger SV",
    "HAMBURG SV": "Hamburger SV",
    "COLOGNE": "Cologne",
    "KÖLN": "Cologne",
    "FC KÖLN": "Cologne",
    "WOLFSBURG": "VfL Wolfsburg",
    "WERDER BREMEN": "Werder Bremen",
    "BREMEN": "Werder Bremen",

    // Eredivisie
    "AJAX": "Ajax",
    "AFC AJAX": "Ajax",
    "PSV": "PSV Eindhoven",
    "PSV EINDHOVEN": "PSV Eindhoven",
    "FEYENOORD": "Feyenoord",
    "AZ ALKMAAR": "AZ Alkmaar",
    "AZ": "AZ Alkmaar",
    "VITESSE": "Vitesse",
    "UTRECHT": "Utrecht",
    "FC UTRECHT": "Utrecht",
    "GRONINGEN": "Groningen",
    "FC GRONINGEN": "Groningen",
    "TWENTE": "Twente",
    "FC TWENTE": "Twente",
    "HEERENVEEN": "Heerenveen",
    "SC HEERENVEEN": "Heerenveen",
    "GO AHEAD EAGLES": "Go Ahead Eagles",
    "GO AHEAD": "Go Ahead Eagles",
    "ZWOLLE": "PEC Zwolle",
    "PEC ZWOLLE": "PEC Zwolle",
    "RODA JC": "Roda JC",
    "RODA": "Roda JC",

    // Uluslararası
    "SHAKHTAR DONETSK": "Shakhtar Donetsk",
    "SHAKHTAR": "Shakhtar Donetsk",
    "DYNAMO KYIV": "Dynamo Kyiv",
    "DINAMO ZAGREB": "Dinamo Zagreb",
    "ZAGREB": "Dinamo Zagreb",
    "STURM GRAZ": "Sturm Graz",
    "STURM": "Sturm Graz",
    "SALZBURG": "FC Salzburg",
    "RED BULL SALZBURG": "FC Salzburg",
    "RAPID WIEN": "Rapid Wien",
    "WIEN": "Rapid Wien",
    "AUSTRIA WIEN": "Austria Wien",
    "AUSTRIA": "Austria Wien",
    "BASEL": "FC Basel",
    "FC BASEL": "FC Basel",
    "YOUNG BOYS": "Young Boys",
    "YB": "Young Boys",
    "LECH POZNAŃ": "Lech Poznan",
    "LECH POZNAN": "Lech Poznan",
    "LEGIA WARSAW": "Legia Warszawa",
    "LEGIA": "Legia Warszawa",
    "BENFICA": "Benfica",
    "PORTO": "Porto",
    "FC PORTO": "Porto",
    "SPORTING": "Sporting CP",
    "SPORTING CP": "Sporting CP",
    "CELTIC": "Celtic",
    "CELTIC FC": "Celtic",
    "RANGERS": "Rangers",
    "FC RANGERS": "Rangers",
    "PSFC CELTIC": "Celtic",
    "BASEL": "FC Basel",
    "ZURICH": "Zurich",
    "FC ZURICH": "Zurich",
    "LAUSANNE": "Lausanne-Sport",
    "LAUSANNE-SPORT": "Lausanne-Sport",
    "ST. GALLEN": "FC St. Gallen",
    "GALATASARAY SK": "Galatasaray",
    "FK CRVENA ZVEZZDA": "Crvena Zvezda",
    "CRVENA ZVEZZDA": "Crvena Zvezda",
    "PARTIZAN": "Partizan",
    "FK PARTIZAN": "Partizan",
    "OLYMPIACOS": "Olympiacos",
    "AEK ATHENS": "AEK Athens",
    "PANATHINAIKOS": "Panathinaikos",
    "PANATHINAIKOS FC": "Panathinaikos",

    // Arjantin
    "VELEZ SARSFIELD": "Velez Sarsfield",
    "VELEZ": "Velez Sarsfield",
    "INDEPENDIENTE RIVADAVIA": "Independiente Rivadavia",
    "INDEPENDIENTE": "Independiente",
    "BOCA JUNIORS": "Boca Juniors",
    "BOCA": "Boca Juniors",
    "RIVER PLATE": "River Plate",
    "RIVER": "River Plate",
    "SAN LORENZO": "San Lorenzo",
    "ESTUDIANTES": "Estudiantes",
    "RACING": "Racing Club",
    "RACING CLUB": "Racing Club",
    "LANUS": "Lanus",
    "LANÚS": "Lanus",
    "DEFENSA Y JUSTICIA": "Defensa y Justicia",
    "BANFIELD": "Banfield",

    // Brezilya
    "FLAMENGO": "Flamengo",
    "PALMEIRAS": "Palmeiras",
    "SANTOS": "Santos",
    "CORINTHIANS": "Corinthians",
    "CRUZEIRO": "Cruzeiro",
    "ATLETICO MINEIRO": "Atletico Mineiro",
    "ATLÉTICO MINEIRO": "Atletico Mineiro",
    "GREMIO": "Gremio",
    "GRÊMIO": "Gremio",
    "INTERNACIONAL": "Internacional",
    "BOTAFOGO": "Botafogo",
    "VASCO DA GAMA": "Vasco da Gama",
    "VASCO": "Vasco da Gama",
    "VILA NOVA": "Vila Nova",
    "VILA NOVA GO": "Vila Nova",
    "CEBOLINHA": "Cebolinha",

    // Diğer
    "JEJU UNITED": "Jeju United",
    "JEJU": "Jeju United",
    "ULSAN HYUNDAI": "Ulsan Hyundai",
    "ULSAN": "Ulsan Hyundai",
    "KAWASAKI FRONTALE": "Kawasaki Frontale",
    "AL RAYYAN": "Al Rayyan",
    "RAYYAN": "Al Rayyan",
    "AL AIN": "Al Ain",
    "NEWCASTLE": "Newport County",
    "NEWPORT": "Newport County",
    "BRISTOL CITY": "Bristol City",
    "COLCHESTER": "Colchester United",
    "COLCHESTER UNITED": "Colchester United",
    "WALSALL": "Walsall",
    "PETERBOROUGH": "Peterborough United",
    "PETERBOROUGH UNITED": "Peterborough United",
    "BOLTON": "Bolton Wanderers",
    "BOLTON WANDERERS": "Bolton Wanderers",
    "COVENTRY": "Coventry City",
    "COVENTRY CITY": "Coventry City",
    "BLACKBURN": "Blackburn Rovers",
    "BLACKBURN ROVERS": "Blackburn Rovers",
    "WATFORD": "Watford",
    "NORWICH": "Norwich City",
    "NORWICH CITY": "Norwich City",
    "MIDDLESBROUGH": "Middlesbrough",
    "SUNDERLAND": "Sunderland",
    "CARDIFF": "Cardiff City",
    "CARDIFF CITY": "Cardiff City",
    "MILLWALL": "Millwall",
    "QUEENS PARK RANGERS": "Queens Park Rangers",
    "QPR": "Queens Park Rangers",
    "FULHAM": "Fulham",
    "SWANSEA": "Swansea City",
    "SWANSEA CITY": "Swansea City",
    "STOKE CITY": "Stoke City",
    "STOKE": "Stoke City",
    "WEST BROMWICH": "West Bromwich Albion",
    "WEST BROM": "West Bromwich Albion",
    "DONCASTER": "Doncaster Rovers",
    "DONCASTER ROVERS": "Doncaster Rovers",
    "ROTHERHAM": "Rotherham United",
    "ROTHERHAM UNITED": "Rotherham United",
    "HULL CITY": "Hull City",
    "HULL": "Hull City",
    "BRENTFORD": "Brentford",
    "BARNSLEY": "Barnsley",
    "LINCOLN": "Lincoln City",
    "LINCOLN CITY": "Lincoln City",
    "SCUNTHORPE": "Scunthorpe United",
    "SCUNTHORPE UNITED": "Scunthorpe United",
    "GRIMSBY": "Grimsby Town",
    "GRIMSBY TOWN": "Grimsby Town",
    "CHELTENHAM": "Cheltenham Town",
    "CHELTENHAM TOWN": "Cheltenham Town",


    // 🏀 BASKETBOL TAKIMLARI - YENİ EKLENEN
    "TURKEY": "Türkiye",
    "TURKIYE": "Türkiye",
    "GERMANY": "Almanya",
    "DEUTSCHLAND": "Almanya",
    "FRANCE": "Fransa",
    "SPAIN": "İspanya",
    "ITALIA": "İtalya",
    "ITALY": "İtalya",
    "NETHERLANDS": "Hollanda",
    "GREECE": "Yunanistan",
    "SERBIA": "Sırbistan",
    "ARGENTINA": "Arjantin",
    "COLOMBIA": "Kolombiya",
    "VENEZUELA": "Venezuela",
    "CHILE": "Şili",
    "PARAGUAY": "Paraguay",
    "URUGUAY": "Uruguay",
    "FINLAND": "Finlandiya",
    "BELGIUM": "Belçika",
    "CZECH REPUBLIC": "Çekya",
    "CZECHIA": "Çekya",
    "SLOVENIA": "Slovenya",
    "LATVIA": "Letonya",
    "CAMEROON": "Kamerun",
    "SENEGAL": "Senegal",
    "TUNISIA": "Tunus",
    "NIGERIA": "Nijerya",
    "GABON": "Gabon",
    "MADAGASCAR": "Madagaskar",
    "MALI": "Mali",
    "MOROCCO": "Fas",
    
    // NBA TAKIMLARI
    "GOLDEN STATE WARRIORS": "Golden State Warriors",
    "GOLDEN STATE": "Golden State Warriors",
    "WARRIORS": "Golden State Warriors",
    "BOSTON CELTICS": "Boston Celtics",
    "CELTICS": "Boston Celtics",
    "LOS ANGELES LAKERS": "Los Angeles Lakers",
    "LAKERS": "Los Angeles Lakers",
    "MIAMI HEAT": "Miami Heat",
    "HEAT": "Miami Heat",
    "DENVER NUGGETS": "Denver Nuggets",
    "NUGGETS": "Denver Nuggets",
    "LOS ANGELES CLIPPERS": "Los Angeles Clippers",
    "CLIPPERS": "Los Angeles Clippers",
    "DALLAS MAVERICKS": "Dallas Mavericks",
    "MAVERICKS": "Dallas Mavericks",
    "CHICAGO BULLS": "Chicago Bulls",
    "BULLS": "Chicago Bulls",
    "BROOKLYN NETS": "Brooklyn Nets",
    "NETS": "Brooklyn Nets",
    "PHILADELPHIA 76ERS": "Philadelphia 76ers",
    "76ERS": "Philadelphia 76ers",
    "NEW YORK KNICKS": "New York Knicks",
    "KNICKS": "New York Knicks",
    "TORONTO RAPTORS": "Toronto Raptors",
    "RAPTORS": "Toronto Raptors",
    
    // WNBA TAKIMLARI
    "DALLAS WINGS": "Dallas Wings",
    "WINGS": "Dallas Wings",
    "CONNECTICUT SUN": "Connecticut Sun",
    "SUN": "Connecticut Sun",
    "GOLDEN STATE VALKYRIES": "Golden State Valkyries",
    "VALKYRIES": "Golden State Valkyries",
    "TORONTO TEMPO": "Toronto Tempo",
    "TEMPO": "Toronto Tempo"
};

// Takım adını standarlaştır
const standardizeTeamName = (name) => {
    if (!name) return name;
    const upper = name.toUpperCase().trim();
    
    // Direkt eşleşme
    if (teamNameMapping[upper]) {
        return teamNameMapping[upper];
    }
    
    // Kısmi eşleşme (Contains)
    for (const [sporekrani, sofascore] of Object.entries(teamNameMapping)) {
        if (upper.includes(sporekrani) && sporekrani.length > 3) {
            return sofascore;
        }
    }
    
    return name; // Eşleşme yoksa orijinalini döndür
};

async function getBroadcasterData() {
    const sports = ['futbol', 'basketbol', 'tenis'];
    const timeZone = 'Europe/Istanbul';
    
    const d = new Date();
    const today = new Date(d);
    const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
    const nextDay = new Date(d); nextDay.setDate(d.getDate() + 2);
    
    const todayStr = today.toLocaleDateString('en-CA', { timeZone });
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone });
    const nextDayStr = nextDay.toLocaleDateString('en-CA', { timeZone });
    
    const allMatches = {
        [todayStr]: { title: `📅 BUGÜN (${today.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [tomorrowStr]: { title: `📅 YARIN (${tomorrow.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] },
        [nextDayStr]: { title: `📅 ERTESİ GÜN (${nextDay.toLocaleDateString('tr-TR', { timeZone, month: 'long', day: 'numeric' }).toUpperCase()})`, matches: [] }
    };

    console.log("🚀 Sarsılmaz İnsan Gözü (Saf Metin) ve Lig Temizleyici Modu Başlatılıyor...");

    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (const sport of sports) {
        console.log(`\n📡 ${sport.toUpperCase()} sayfası hedefleniyor...`);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 1024 });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        try {
            const url = `https://www.sporekrani.com/home/sport/${sport}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 400;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= document.body.scrollHeight || totalHeight > 15000) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 150);
                });
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

            // 🎯 EKRANDAKİ LOGOLARI VE METİNLERİ OKUYAN ANA MOTOR
            const textFallback = await page.evaluate(() => {
                document.querySelectorAll('img').forEach(img => {
                    let alt = img.getAttribute('alt') || img.getAttribute('title') || '';
                    let src = img.getAttribute('src') || '';

                    // 🛑 REKLAM VE MOBİL BANNER ENGELİ: Alakasız görselleri kesinlikle es geç
                    if (
                        src.match(/google-play|app-store|mobil|banner|reklam|advertisement|logo-site|site-logo|header|footer|avatar/i) ||
                        alt.match(/indir|download|store|banner|reklam|logo|icon|chevron|arrow/i)
                    ) {
                        return;
                    }

                    // Alt etiketi boşsa görsel url'inden ismi kurtar
                    if ((!alt || alt.length < 2) && src) {
                        let match = src.match(/\/([^\/?#]+)\.(png|jpe?g|webp|gif)/i);
                        if (match && match[1]) {
                            alt = match[1].replace(/[-_]/g, ' ');
                        }
                    }

                    if (alt && alt.length > 2) {
                        const cleanAlt = alt.replace(/logosu|logo|icon/gi, '').trim();
                        if (cleanAlt && !cleanAlt.match(/chevron|arrow|play|menu|search|user/i)) {
                            const txt = document.createTextNode(`\n${cleanAlt}\n`);
                            img.parentNode.insertBefore(txt, img);
                        }
                    }
                });

                const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l);
                const matches = [];
                let currentDateStr = ''; 

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (line.match(/Bugün|Yarın|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar/i) && line.length < 25) {
                        currentDateStr = line.toUpperCase();
                    }

                    if (/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(line)) {
                        const chunk = [];
                        for(let j = 1; j <= 8; j++) { 
                            const nextLine = lines[i+j];
                            if (!nextLine || /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nextLine) || nextLine.match(/Bugün|Yarın/i)) break;
                            chunk.push(nextLine);
                        }

                        if (currentDateStr && chunk.length >= 2) {
                            matches.push({ saat: line, dateSection: currentDateStr, lines: chunk });
                        }
                    }
                }
                return matches;
            });

            console.log(`🔍 ${sport.toUpperCase()}: Ekrandan ${textFallback.length} adet ham maç bloğu okundu. Ligler temizleniyor...`);

            const sportName = sport.charAt(0).toUpperCase() + sport.slice(1);

            textFallback.forEach(m => {
                let targetDate = null; 
                
                if (m.dateSection.includes('BUGÜN')) {
                    targetDate = todayStr;
                } else if (m.dateSection.includes('YARIN')) {
                    targetDate = tomorrowStr;
                } else {
                    const matchedKey = [todayStr, tomorrowStr, nextDayStr].find(str => {
                        const dayNum = new Date(str).getDate().toString();
                        return new RegExp(`\\b${dayNum}\\b`).test(m.dateSection);
                    });
                    if (matchedKey) targetDate = matchedKey;
                }

                if (!targetDate) return; 

                let mac = '';
                let rawChannels = [];

                const matchIdx = m.lines.findIndex(l => l.includes('-') || l.toLowerCase().includes(' vs '));
                if (matchIdx !== -1) {
                    mac = m.lines[matchIdx];
                    rawChannels = m.lines.filter((_, idx) => idx !== matchIdx);
                } else {
                    mac = m.lines[0];
                    rawChannels = m.lines.slice(1);
                }

                // 🔥 YENİ: Maçtaki takım adlarını standarlaştır
                const macParts = mac.split(/\s*[-–—]\s*|vs|VS/i);
                if (macParts.length === 2) {
                    const homeStandardized = standardizeTeamName(macParts[0].trim());
                    const awayStandardized = standardizeTeamName(macParts[1].trim());
                    mac = `${homeStandardized} - ${awayStandardized}`;
                }

                // 🌟 AKILLI BEYAZ LİSTE (WHITELIST) FİLTRESİ
                const validChannels = [
                    "trt", "bein", "beın", "s sport", "ssport", "tivibu", "smart spor", "spor smart",
                    "d-smart", "euroleague tv", "nba tv", "nba league pass", "prime video", "amazon", "youtube", 
                    "exxen", "tv8", "a spor", "eurosport", "içtimai", "cbc sport", "idman", "az tv", 
                    "fb tv", "gs tv", "bjk tv", "kanal d", "star tv", "show tv", "atv", "ntv", "tabii", 
                    "red bull", "wta tv", "atp tv", "fiba tv", "tbf tv", "tv100", "yayın yok", "caaf", "caaf tv"
                ];

                let filteredChannels = rawChannels.filter(line => {
                    if (!line || line.length < 2) return false;
                    const l = line.toLowerCase();
                    
                    // Sitenin en altındaki anlamsız footer metinleri kanalların arasına sızmasın
                    if (l.match(/canlı tv|yayın akışı|video|kupalar|oyun|futbolu|tenisin|aboneliği/i)) {
                        return false;
                    }

                    // Satırın içinde geçerli bir kanal adı var mı?
                    return validChannels.some(channel => l.includes(channel));
                });

                // Kalan tertemiz kanalları birleştir
                let cleanYayin = filteredChannels.join(' / ')
                    .replace(/chevron_right/gi, '')
                    .replace(/^[ \/]+|[ \/]+$/g, '')
                    .replace(/\s*\/\s*\/\s*/g, ' / ')
                    .trim();

                if (!cleanYayin || cleanYayin === '/' || cleanYayin.length < 2) cleanYayin = 'Yayın Yok';

                const lowerMac = mac.toLowerCase();
                
                if (
                    lowerMac.includes('izle') || 
                    lowerMac.includes('program') || 
                    lowerMac.includes('stüdyo') ||
                    lowerMac.includes('bülten') ||
                    lowerMac.includes('özet') ||
                    lowerMac.includes('haber') ||
                    mac.length < 5
                ) return;

                if (allMatches[targetDate]) {
                    allMatches[targetDate].matches.push({
                        saat: m.saat,
                        spor: sportName,
                        mac: mac,
                        yayin: cleanYayin
                    });
                }
            });

        } catch (error) {
            console.error(`🚨 ${sport.toUpperCase()} hatası:`, error.message);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    [todayStr, tomorrowStr, nextDayStr].forEach(key => {
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
    console.log("\n💾 yayinci_bilgisi.json kusursuz maçlar ve taze kanallarla kaydedildi.");
}

getBroadcasterData().catch(e => { console.error(e); process.exit(1); });
