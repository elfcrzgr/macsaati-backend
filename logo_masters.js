const fs = require('fs');
const path = require('path');
const axios = require('axios');

const FIREBASE_BASE_URL = "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

const configs = [
{
    name: 'Futbol',
    firebasePath: 'matches_football.json',
    dirs: {
        team: path.join(__dirname, 'football', 'logos'),
        tournament: path.join(__dirname, 'football', 'tournament_logos')
    }
},
{
    name: 'Basketbol',
    firebasePath: 'matches_basketball.json',
    dirs: {
        team: path.join(__dirname, 'basketball', 'logos'),
        nba: path.join(__dirname, 'basketball', 'logos', 'NBA'),
        tournament: path.join(__dirname, 'basketball', 'tournament_logos')
    }
},
{
    name: 'Tenis',
    firebasePath: 'matches_tennis.json',
    dirs: {
        tournament: path.join(__dirname, 'tennis', 'tournament_logos'),
        team: path.join(__dirname, 'tennis', 'logos')
    }
}
];

// klasörleri hazırla
for (const conf of configs) {
    Object.values(conf.dirs).forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

function extractId(url) {
    if (!url || typeof url !== 'string') return null;
    const parts = url.split('/');
    return parts[parts.length - 1].split('.')[0];
}

async function fetchFirebase(file) {
    const url = `${FIREBASE_BASE_URL}${file}`;
    const res = await axios.get(url);
    return res.data;
}

async function download(url, filePath) {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(filePath, res.data);
}

async function start() {
    console.log("🚀 DEBUG LOGO SYSTEM + FIREBASE STARTED\n");

    let totalSuccess = 0;
    let totalFail = 0;

    for (const conf of configs) {

        console.log(`\n📦 ===== ${conf.name.toUpperCase()} =====`);

        const data = await fetchFirebase(conf.firebasePath);

        const matches = data.matches || data.events || [];
        console.log(`📄 Matches: ${matches.length}`);

        const missing = [];

        for (const m of matches) {

            // 🧠 TEAM DEBUG
            if (!m.homeTeam || !m.awayTeam) {
                console.log("⚠️ SKIP: missing team structure");
                continue;
            }

            const teams = [m.homeTeam, m.awayTeam];

            for (const team of teams) {

                if (!team || !team.logo) {
                    console.log("⚠️ SKIP: no logo field", team?.name);
                    continue;
                }

                const id = extractId(team.logo);

                console.log(`🔎 CHECK TEAM: ${team.name} | ID: ${id}`);

                if (!id) {
                    console.log("⚠️ SKIP: invalid id");
                    continue;
                }

                const isNBA = (m.tournament || "").toUpperCase().includes("NBA");

                let targetDir = conf.dirs.team;
                if (conf.name === "Basketbol" && isNBA) {
                    targetDir = conf.dirs.nba;
                }

                const targetPath = path.join(targetDir, `${id}.png`);

                if (!fs.existsSync(targetPath)) {
                    console.log(`❌ MISSING: ${team.name} → ${id}`);
                    missing.push({ id, name: team.name, path: targetPath });
                } else {
                    console.log(`✅ EXISTS: ${team.name}`);
                }
            }
        }

        console.log(`\n🔍 Missing: ${missing.length}`);

        for (const item of missing) {
            try {
                const url = `https://api.sofascore.app/api/v1/team/${item.id}/image`;

                console.log(`⬇️ DOWNLOADING: ${item.name} | ${item.id}`);

                const res = await axios.get(url, { responseType: 'arraybuffer' });

                if (res.data.byteLength > 800) {
                    fs.writeFileSync(item.path, res.data);
                    console.log(`✅ SAVED: ${item.name}`);
                    totalSuccess++;
                } else {
                    console.log(`⚠️ SMALL FILE SKIP: ${item.name}`);
                    totalFail++;
                }

            } catch (e) {
                console.log(`❌ FAIL: ${item.name} | ${e.response?.status || "NO_RESPONSE"}`);
                totalFail++;
            }

            await new Promise(r => setTimeout(r, 800));
        }

        console.log(`\n✅ ${conf.name} DONE`);
    }

    console.log(`\n📊 FINAL`);
    console.log(`✅ Success: ${totalSuccess}`);
    console.log(`❌ Fail: ${totalFail}`);
}

start();