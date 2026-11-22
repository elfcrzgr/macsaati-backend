const fs = require('fs');
const { execFileSync } = require('child_process');
const norm = s => String(s||"").toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
const ids = JSON.parse(fs.readFileSync('team_ids.cache.json','utf8'));
const known = new Set(Object.keys(ids.other).map(norm));
const get = u => {
  for (let i = 0; i < 3; i++) {
    try {
      return execFileSync('curl', ['-sL', '--max-time', '40', u,
        '-H', 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
        '-H', 'Referer: https://tbf.org.tr/'], { maxBuffer: 50e6 });
    } catch (e) { console.log(`tekrar deneniyor (${i + 1}/3): ${u.slice(0, 70)}`); }
  }
  throw new Error('3 denemede de alınamadı: ' + u);
};
fs.mkdirSync('logos_yeni',{recursive:true});
const done = {};
for (const act of [22214, 22215]) {
  const base = `https://tbf.org.tr/api/Match/get-all-matches-for-filter?ActivityId=${act}&Page=1&PageSize=-1`;
  const cur = JSON.parse(get(base).toString()).data || [];
  const wk = parseInt((cur[0]?.week || '').match(/\d+/)?.[0]);
  const all = [...cur];
  if (wk) for (const w of [wk-1, wk+1]) all.push(...(JSON.parse(get(`${base}&WeekFilter=${w}`).toString()).data || []));
  for (const m of all) for (const t of [m.homeTeam, m.awayTeam]) {
    if (!t || known.has(norm(t.name)) || done[t.name]) continue;
    if (!t.logoUrl) { console.log(`YOK: ${t.name} (TBF logo vermiyor)`); done[t.name] = 1; continue; }
    const url = (t.logoUrl.startsWith('http') ? t.logoUrl : 'https://tbf.org.tr' + t.logoUrl).replace(/ /g, '%20');
    const ext = (url.match(/\.(png|jpe?g|webp|svg)(\?|$)/i) || [])[1] || 'png';
    const file = norm(t.name).replace(/ /g,'-') + '.' + ext.toLowerCase();
    const buf = get(url);
    fs.writeFileSync('logos_yeni/' + file, buf);
    done[t.name] = file;
    console.log(`  "${t.name}": "${file}",   // ${buf.length} bayt`);
  }
}