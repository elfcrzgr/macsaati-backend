#!/usr/bin/env python3
"""
SofaScore API TLS Fingerprinting Bypass using curl_cffi
Bu script 403 Forbidden hatasını aşmak için Chrome TLS fingerprint'ini kullanır.
"""

import sys
import json
import time
from curl_cffi import requests

class SofascoreTLSBypass:
    def __init__(self):
        self.session = requests.Session(
            impersonate="chrome123",  # Chrome 123 TLS fingerprinti
            headers={
                "Origin": "https://www.sofascore.com",
                "Referer": "https://www.sofascore.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-site",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="123", "Google Chrome";v="123"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": "Windows",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache"
            },
            timeout=10
        )

    def fetch(self, url):
        """
        URL'den veri çek ve JSON olarak döndür
        """
        try:
            response = self.session.get(url, allow_redirects=True)
            
            if response.status_code == 200:
                return {
                    "status": "success",
                    "data": response.json(),
                    "http_code": response.status_code
                }
            elif response.status_code == 403:
                return {
                    "status": "error_403",
                    "error": "403 Forbidden - TLS bypass başarısız",
                    "http_code": 403
                }
            else:
                return {
                    "status": "error",
                    "error": f"HTTP {response.status_code}: {response.reason}",
                    "http_code": response.status_code
                }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "http_code": 0
            }

def main():
    if len(sys.argv) < 2:
        result = {
            "status": "error",
            "error": "URL argument required"
        }
        print(json.dumps(result))
        sys.exit(1)

    url = sys.argv[1]
    
    try:
        client = SofascoreTLSBypass()
        result = client.fetch(url)
        print(json.dumps(result))
    except Exception as e:
        result = {
            "status": "error",
            "error": str(e)
        }
        print(json.dumps(result))
        sys.exit(1)

if __name__ == "__main__":
    main()
