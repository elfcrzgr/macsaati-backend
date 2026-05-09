const fs = require("fs");
const path = require("path");
const axios = require("axios");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const FIREBASE_BASE_URL =
  "https://macsaati-a743a-default-rtdb.europe-west1.firebasedatabase.app/";

const configs = [
  {
    name: "Futbol",
    firebasePath: "matches_football.json",
    dirs: {
      team: path.join(__dirname, "football", "logos"),
      tournament: path.join(__dirname, "football", "tournament_logos"),
    },
  },
  {
    name: "Basketbol",
    firebasePath: "matches_basketball.json",
    dirs: {
      team: path.join(__dirname, "basketball", "logos"),
      nba: path.join(__dirname, "basketball", "logos", "NBA"),
      tournament: path.join(__dirname, "basketball", "tournament_logos"),
    },
  },
  {
    name: "Tenis",
    firebasePath: "matches_tennis.json",
    dirs: {
      tournament: path.join(__dirname, "tennis", "tournament_logos"),
      team: path.join(__dirname, "tennis", "logos"),
    },
  },
];

// klasörler
for (const c of configs) {
  Object.values(c.dirs).forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractId(url) {
  if (!url) return null;
  return url.split("/").pop().split(".")[0];
}

async function fetchFirebase(file) {
  const res = await axios.get(`${FIREBASE_BASE_URL}${file}`);
  return res.data;
}

// ===============================
// 🧠 PUPPETEER POOL (V4 CORE)
// ===============================
let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browserInstance;
}

// ===============================
// 🚀 IMAGE DOWNLOAD (REAL BROWSER)
// ===============================
async function downloadWithBrowser(url, filePath) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36"
  );

  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  if (!response) throw new Error("no response");

  const buffer = await response.buffer();
  fs.writeFileSync(filePath, buffer);

  await page.close();
}

// ===============================
// 🔁 SMART RETRY ENGINE
// ===============================
async function safeDownload(url, filePath, name) {
  let delay = 2000;

  for (let i = 0; i < 3; i++) {
    try {
      await downloadWithBrowser(url, filePath);
      console.log(`   ✅ OK: ${name}`);
      return true;
    } catch (e) {
      console.log(`   🚫 FAIL (${i + 1}/3): ${name}`);

      await sleep(delay);
      delay *= 2; // exponential backoff
    }
  }

  console.log(`   ❌ FINAL FAIL: ${name}`);
  return false;
}

// ===============================
// 🚀 ENGINE START
// ===============================
async function start() {
  console.log("🚀 LOGO ENGINE V4 STARTED\n");

  let success = 0;
  let fail = 0;

  for (const conf of configs) {
    console.log(`\n📦 ===== ${conf.name} =====`);

    const data = await fetchFirebase(conf.firebasePath);
    const matches = data.matches || data.events || [];

    console.log(`📄 Matches: ${matches.length}`);

    const missing = [];
    const cache = new Set();

    for (const m of matches) {
      if (!m.homeTeam || !m.awayTeam) continue;

      const teams = [m.homeTeam, m.awayTeam];

      for (const t of teams) {
        if (!t?.logo) continue;

        const id = extractId(t.logo);
        if (!id || cache.has(id)) continue;

        cache.add(id);

        const isNBA =
          (m.tournament || "").toUpperCase().includes("NBA");

        let dir = conf.dirs.team;
        if (conf.name === "Basketbol" && isNBA) {
          dir = conf.dirs.nba;
        }

        const filePath = path.join(dir, `${id}.png`);

        if (!fs.existsSync(filePath)) {
          console.log(`❌ MISSING: ${t.name} (${id})`);
          missing.push({ id, name: t.name, path: filePath });
        }
      }
    }

    console.log(`\n🔍 Missing: ${missing.length}`);

    // QUEUE SYSTEM (IMPORTANT)
    for (const item of missing) {
      const url = `https://api.sofascore.app/api/v1/team/${item.id}/image`;

      console.log(`⬇️ DOWNLOADING: ${item.name} | ${item.id}`);

      const ok = await safeDownload(url, item.path, item.name);

      if (ok) success++;
      else fail++;

      // 🔥 CRITICAL ANTI-BLOCK DELAY
      await sleep(3500);
    }

    console.log(`\n✅ ${conf.name} DONE`);
  }

  if (browserInstance) await browserInstance.close();

  console.log(`\n📊 FINAL RESULT`);
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Fail: ${fail}`);
}

start();