const matchId = process.argv[2];
fetch(`https://api3.fotmob.com/matchDetails?matchId=${matchId}`, {
    headers: {
        "Host": "api3.fotmob.com",
        "fotmob-version": "1243.0",
        "Accept": "application/json, application/xml, */*",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FotMob",
        "Accept-Language": "tr-TR,tr;q=0.9"
    }
}).then(async r => {
    const t = await r.text();
    console.log('HTTP', r.status);
    console.log(t.slice(0, 300));
}).catch(e => console.log('HATA', e.message));
