#!/usr/bin/env python3
"""
MAC SAATİ - Python Undetected Chromedriver ile SofaScore veri çekici
GitHub Actions üzerinde Cloudflare'i bypass ediyor
"""

import undetected_chromedriver as uc
import json
from datetime import datetime, timedelta
import sys
import time
import os
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Konfigürasyonlar
GITHUB_USER = "elfcrzgr"
REPO_NAME = "macsaati-backend"
TEAM_FOLDER = "logos"
TOURNAMENT_FOLDER = "tournament_logos"

FOOTBALL_TEAM_LOGO_BASE = f"https://raw.githubusercontent.com/{GITHUB_USER}/{REPO_NAME}/main/football/{TEAM_FOLDER}/"
FOOTBALL_TOURNAMENT_LOGO_BASE = f"https://raw.githubusercontent.com/{GITHUB_USER}/{REPO_NAME}/main/football/{TOURNAMENT_FOLDER}/"
OUTPUT_FILE = "matches_football.json"

# Ülke çevirisi
TEAM_TRANSLATIONS = {
    "turkey": "Türkiye", "germany": "Almanya", "france": "Fransa", "england": "İngiltere",
    "spain": "İspanya", "italy": "İtalya", "portugal": "Portekiz", "netherlands": "Hollanda",
    "belgium": "Belçika", "switzerland": "İsviçre", "austria": "Avusturya", "croatia": "Hırvatistan",
    "denmark": "Danimarka", "scotland": "İskoçya", "hungary": "Macaristan", "serbia": "Sırbistan",
    "poland": "Polonya", "czechia": "Çekya", "romania": "Romanya", "slovakia": "Slovakya",
    "slovenia": "Slovenya", "georgia": "Gürcistan", "albania": "Arnavutluk", "norway": "Norveç",
    "sweden": "İsveç", "ukraine": "Ukrayna", "greece": "Yunanistan", "wales": "Galler",
    "finland": "Finlandiya", "ireland": "İrlanda", "northernireland": "Kuzey İrlanda",
    "iceland": "İzlanda", "israel": "İsrail", "bulgaria": "Bulgaristan", "kazakhstan": "Kazakistan",
    "azerbaijan": "Azerbaycan", "armenia": "Ermenistan", "kosovo": "Kosova", "montenegro": "Karadağ",
    "estonia": "Estonya", "latvia": "Letonya", "lithuania": "Litvanya", "belarus": "Belarus",
    "moldova": "Moldova", "luxembourg": "Lüksemburg", "faroeislands": "Faroe Adaları",
    "malta": "Malta", "andorra": "Andorra", "sanmarino": "San Marino", "gibraltar": "Cebelitarık",
    "liechtenstein": "Liechtenstein", "northmacedonia": "K. Makedonya", "cyprus": "Güney Kıbrıs",
    "brazil": "Brezilya", "argentina": "Arjantin", "uruguay": "Uruguay", "colombia": "Kolombiya",
    "chile": "Şili", "peru": "Peru", "ecuador": "Ekvador", "paraguay": "Paraguay",
    "venezuela": "Venezuela", "bolivia": "Bolivya", "usa": "ABD", "mexico": "Meksika",
    "canada": "Kanada", "japan": "Japonya", "southkorea": "Güney Kore", "australia": "Avustralya"
}

ELITE_LEAGUE_IDS = [52, 351, 98, 17, 8, 23, 35, 11, 34, 37, 13, 238, 242, 938, 393, 7, 750, 10248, 10783, 1, 679, 17015]
REGULAR_LEAGUE_IDS = [10, 155, 4664, 696, 97, 11415, 11416, 11417, 15938, 13363, 10618]
ALL_TARGET_IDS = ELITE_LEAGUE_IDS + REGULAR_LEAGUE_IDS

BROADCASTER_CONFIGS = {
    34: "beIN Sports", 52: "beIN Sports", 238: "S Sport Plus", 242: "Apple TV", 938: "S Sport / S Sport Plus",
    17: "beIN Sports", 8: "S Sport", 23: "S Sport", 7: "TRT / Tabii", 11: "TRT 1 / Tabii", 351: "TRT Spor / Tabii",
    37: "S Sport Plus / TV+", 10: "Exxen / S Sport+", 13: "Spor Smart", 393: "CBC Sport", 155: "Spor Smart / Exxen",
    10618: "Exxen / FIFA+", 4664: "S Sport+ / TV+", 98: "beIN Sports / TRT Spor", 97: "TFF YouTube",
    11417: "TFF YouTube", 11416: "TFF YouTube", 11415: "TFF YouTube", 15938: "TFF YouTube",
    696: "DAZN / YouTube", 13363: "USL YouTube", 10783: "S Sport Plus / TRT", 232: "S Sport Plus / DAZN", 1: "TRT 1 / Tabii"
}

def translate_team(name):
    if not name:
        return name
    clean_search = ''.join(c for c in name if c.isalpha()).lower()
    for eng, tr in TEAM_TRANSLATIONS.items():
        if eng in clean_search:
            return name.replace(next((c for c in name if c.isalpha()), ''), tr, 1) if eng in clean_search else tr
    return name

def get_broadcaster(ut_id, h_name, a_name, t_name, ut_name):
    hn = h_name.lower()
    an = a_name.lower()
    tn = t_name.lower()
    utn = ut_name.lower()

    is_turkey = "turkey" in hn or "turkey" in an or "türkiye" in hn or "türkiye" in an
    is_playoff = "play-off" in tn or "playoff" in tn or "play-off" in utn or "playoff" in utn

    if ut_id in [748, 750]:
        return "TRT Spor / Tabii" if is_turkey else "Exxen"
    if ut_id == 11 or "world cup qual" in utn or "dünya kupası eleme" in utn:
        if is_turkey:
            return "TV8" if is_playoff else "TRT 1 / Tabii"
        return "Exxen" if is_playoff else "S Sport Plus"

    if ut_id in BROADCASTER_CONFIGS:
        return BROADCASTER_CONFIGS[ut_id]

    if "j1 league" in utn:
        return "YouTube (J.League Int.)"
    if "baller league" in utn:
        return "Twitch / YouTube (Global)"
    if "primera a" in utn or "primera división" in utn:
        return "TV Yayını Yok (Yerel)"
    if "mls next pro" in utn:
        return "Apple TV / OneFootball"

    return "Resmi Yayıncı / Canlı Skor"

def get_tr_date(offset=0):
    """Istanbul saat diliminde tarihi al"""
    d = datetime.now() + timedelta(days=offset)
    return d.strftime("%Y-%m-%d")

def fetch_with_undetected_chrome(url):
    """Undetected Chromedriver ile veri çek"""
    try:
        print(f"Chrome baslatılıyor: {url}")
        
        options = uc.ChromeOptions()
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--start-maximized")
        
        driver = uc.Chrome(options=options, version_main=None)
        driver.set_page_load_timeout(30)
        
        driver.get(url)
        
        # Sayfanın tamamen yüklenmesini bekle
        time.sleep(3)
        
        # JSON verisini çek
        body_text = driver.find_element(By.TAG_NAME, "body").text
        driver.quit()
        
        if not body_text or body_text.startswith("<"):
            print("HTML dönüyor, veri çekilemedi")
            return None
        
        data = json.loads(body_text)
        return data
        
    except Exception as e:
        print(f"Hata: {str(e)}")
        try:
            driver.quit()
        except:
            pass
        return None

def main():
    print("MAC SAATİ AKILLI MOTOR BASLATILDI (Python + Undetected-Chromedriver)")
    
    all_events = []
    valid_dates = [get_tr_date(0), get_tr_date(1), get_tr_date(2)]
    print(f"Hedef Tarihler: {', '.join(valid_dates)}")

    # Ana API çağrıları
    for date in valid_dates:
        print(f"Tarih çekiliyor: {date}")
        api_url = f"https://www.sofascore.com/api/v1/sport/football/scheduled-events/{date}"
        
        data = fetch_with_undetected_chrome(api_url)
        
        if data and data.get("events"):
            print(f"Etkinlik bulundu: {len(data['events'])}")
            
            filtered = [e for e in data["events"] if e.get("tournament", {}).get("uniqueTournament", {}).get("id") in ALL_TARGET_IDS]
            
            correctly_dated = []
            for e in filtered:
                event_time = datetime.fromtimestamp(e["startTimestamp"])
                day_str = event_time.strftime("%Y-%m-%d")
                if day_str in valid_dates:
                    correctly_dated.append(e)
            
            print(f"Filtrelenen maclar: {len(correctly_dated)}")
            all_events.extend(correctly_dated)
        else:
            print(f"Veri yok: {date}")
        
        time.sleep(2)

    print(f"Toplam etkinlik: {len(all_events)}")

    # Veri işleme
    final_matches_map = {}
    for e in all_events:
        ut = e.get("tournament", {}).get("uniqueTournament", {})
        if not ut:
            continue
        
        ut_id = ut.get("id")
        ut_name = ut.get("name", "")
        lower_name = ut_name.lower()
        t_name = e.get("tournament", {}).get("name", "")
        h_name = e.get("homeTeam", {}).get("name", "")
        a_name = e.get("awayTeam", {}).get("name", "")
        
        match_key = f"{h_name}_{a_name}_{ut_id}"
        
        if match_key in final_matches_map:
            continue
        
        status_type = e.get("status", {}).get("type", "")
        is_finished = status_type == "finished"
        is_in_progress = status_type == "inprogress"
        is_canceled = status_type in ["canceled", "postponed"]
        
        event_time = datetime.fromtimestamp(e["startTimestamp"])
        time_string = event_time.strftime("%H:%M")
        
        if is_in_progress:
            time_string += " CANLI"
        elif is_canceled:
            time_string = "İPTAL"
        
        is_excluded = "u19" in lower_name or "u21" in lower_name or "women" in lower_name
        has_score = is_finished or is_in_progress
        
        match_obj = {
            "id": e.get("id"),
            "isElite": ut_id in ELITE_LEAGUE_IDS and not is_excluded,
            "status": status_type,
            "fixedDate": event_time.strftime("%Y-%m-%d"),
            "fixedTime": time_string,
            "timestamp": e["startTimestamp"] * 1000,
            "broadcaster": get_broadcaster(ut_id, h_name, a_name, t_name, ut_name),
            "homeTeam": {
                "name": translate_team(h_name),
                "logo": FOOTBALL_TEAM_LOGO_BASE + str(e.get("homeTeam", {}).get("id", "")) + ".png"
            },
            "awayTeam": {
                "name": translate_team(a_name),
                "logo": FOOTBALL_TEAM_LOGO_BASE + str(e.get("awayTeam", {}).get("id", "")) + ".png"
            },
            "tournamentLogo": FOOTBALL_TOURNAMENT_LOGO_BASE + str(ut_id) + ".png",
            "homeScore": str(e.get("homeScore", {}).get("display", "0")) if has_score else "-",
            "awayScore": str(e.get("awayScore", {}).get("display", "0")) if has_score else "-",
            "tournament": ut_name
        }
        final_matches_map[match_key] = match_obj

    final_matches = sorted(final_matches_map.values(), key=lambda x: x["timestamp"])
    
    output_data = {
        "success": True,
        "lastUpdated": datetime.now().isoformat(),
        "totalMatches": len(final_matches),
        "matches": final_matches
    }
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"İŞLEM TAMAMLANDI: {len(final_matches)} mac")

if __name__ == "__main__":
    main()
