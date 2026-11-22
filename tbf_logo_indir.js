const fs = require('fs');
const { execFileSync } = require('child_process');

const SKIP_RE = /fuzul|tarfin|gelisim/i; // alt takımları atla, istemezsen /^$/ yap
const IDS_FILE = 'basketball/team_ids.json';
const LOGO_DIR = 'basketball/logos';

const norm = s => String(s||"").toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();

if (!fs.existsSync(IDS_FILE)) {
  console.log(`${IDS_FILE} bulunamadı. Bu script repo klasöründe (basketball/ klasörünün olduğu yerde) çalışmalı.`);
  process.exit(1);
}
fs.mkdirSync(LOGO_DIR, { recursive: true });
const ids = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));
const known = new Set(Object.keys(ids.other).map(norm));

const get = u => {
  for (let i = 0; i < 3; i++) {
    try {
      return execFileSync('curl', ['-sfL', '--max-time', '40', u,
        '-H', 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
        '-H', 'Referer: https://tbf.org.tr/'], { maxBuffer: 50e6 });
    } catch (e) { console.log(`tekrar deneniyor (${i+1}/3)`); }
  }
  throw new Error('alınamadı: ' + u);
};

const added = [], failed = [], seen = new Set();
for (const act of [22214, 22215]) {
  const base = `https://tbf.org.tr/api/Match/get-all-matches-for-filter?ActivityId=${act}&Page=1&PageSize=-1`;
  let all = [];
  try {
    const cur = JSON.parse(get(base).toString()).data || [];
    all = [...cur];
    const wk = parseInt((cur[0]?.week || '').match(/\d+/)?.[0]);
    if (wk) for (const w of [wk-1, wk+1]) {
      try { all.push(...(JSON.parse(get(`${base}&WeekFilter=${w}`).toString()).data || [])); } catch (e) {}
    }
  } catch (e) { console.log(`ActivityId=${act} alınamadı`); continue; }

  for (const m of all) for (const t of [m.homeTeam, m.awayTeam]) {
    if (!t || seen.has(t.name)) continue;
    seen.add(t.name);
    if (known.has(norm(t.name)) || SKIP_RE.test(norm(t.name))) continue;
    if (!t.logoUrl) { failed.push(t.name); continue; }
    const url = (t.logoUrl.startsWith('http') ? t.logoUrl : 'https://tbf.org.tr' + t.logoUrl).replace(/ /g, '%20');
    const ext = ((url.match(/\.(png|jpe?g|webp|svg)(\?|$)/i) || [])[1] || 'png').toLowerCase();
    const file = norm(t.name).replace(/ /g, '-') + '.' + ext;
    try {
      const buf = get(url);
      if (buf.length < 1000) throw new Error('çok küçük');
      fs.writeFileSync(`${LOGO_DIR}/${file}`, buf);
      ids.other[t.name] = file;
      added.push(t.name);
      console.log(`✅ ${t.name} -> ${file} (${buf.length} bayt)`);
    } catch (e) { failed.push(t.name); console.log(`❌ ${t.name}`); }
  }
}

if (added.length) {
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
  console.log(`\n${added.length} takım team_ids.json'a eklendi.`);
  if (fs.existsSync('.git')) {
    try {
      const git = (...a) => execFileSync('git', a, { stdio: 'inherit' });
      git('add', 'basketball');
      git('commit', '-m', `TBF logoları eklendi (${added.length})`);
      git('pull', '--rebase');
      git('push');
      console.log('🚀 GitHub\'a gönderildi.');
    } catch (e) { console.log('⚠️ git push olmadı, elle yap: git add . && git commit && git push'); }
  } else console.log('Bu klasör git deposu değil, dosyaları GitHub\'a elle yükle.');
} else console.log('Eklenecek yeni logo yok.');
if (failed.length) console.log('\nLogosu alınamayanlar (elle eklenmeli):\n- ' + failed.join('\n- '));