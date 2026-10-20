"""
Local Development & API Proxy Server for KhanPro.me
Serves static frontend and proxies /api/* calls to Cloudflare Email Routing API
"""
import http.server
import socketserver
import urllib.request
import urllib.error
import json
import os

PORT = 8080
ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "24c0dbe8161ec51bd07d1b0397c6d315")
ZONE_ID = os.environ.get("CF_ZONE_ID", "bdc1725e110f146b6739d6a16605a29c")
API_TOKEN = os.environ.get("CF_API_TOKEN", "")
if not API_TOKEN:
    # Try reading from local .env if available
    try:
        if os.path.exists(".env"):
            with open(".env") as f:
                for line in f:
                    if line.startswith("CF_API_TOKEN="):
                        API_TOKEN = line.strip().split("=", 1)[1]
    except Exception:
        pass

class KhanProHandler(http.server.SimpleHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.handle_api_post()
        else:
            self.send_error(404, "Not Found")

    def handle_api_get(self):
        path = self.path.split("?")[0]
        query = self.path.split("?")[1] if "?" in self.path else ""

        if path == "/api/health":
            self.send_json(200, {"status": "ok", "service": "khanpro-local-proxy"})
            return

        if path == "/api/check-status":
            params = dict(qc.split("=") for qc in query.split("&") if "=" in qc)
            email = urllib.parse.unquote(params.get("email", "")).strip().lower()

            if not email:
                self.send_json(400, {"error": "Missing email query param"})
                return

            try:
                url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/email/routing/addresses"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
                with urllib.request.urlopen(req) as resp:
                    data = json.loads(resp.read().decode())
                
                matched = next((item for item in data.get("result", []) if item.get("email", "").lower() == email), None)
                if not matched:
                    self.send_json(200, {
                        "found": False,
                        "verified": False,
                        "status": "not_found",
                        "message": "Destination address not found."
                    })
                    return

                is_verified = matched.get("status") == "verified" or bool(matched.get("verified"))
                self.send_json(200, {
                    "found": True,
                    "email": matched.get("email"),
                    "verified": is_verified,
                    "status": "verified" if is_verified else "unverified",
                    "verifiedAt": matched.get("verified")
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if path == "/api/list-destinations":
            try:
                url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/email/routing/addresses"
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
                with urllib.request.urlopen(req) as resp:
                    data = json.loads(resp.read().decode())
                
                destinations = [{
                    "email": item.get("email"),
                    "verified": item.get("status") == "verified" or bool(item.get("verified")),
                    "created": item.get("created"),
                    "status": item.get("status")
                } for item in data.get("result", [])]

                self.send_json(200, {"success": True, "destinations": destinations})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if path == "/api/yt-config":
            try:
                import crawler, youtube_api_pool
                keys = crawler.load_saved_api_keys()
                cfg_path = str(crawler.api_key_config_path())
                q_summary = youtube_api_pool.quota_summary_text(keys) if keys else "Koi key nahi mili."
                self.send_json(200, {
                    "success": True,
                    "keys": keys,
                    "config_path": cfg_path,
                    "quota_summary": q_summary
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        self.send_json(404, {"error": "API route not found"})

    def handle_api_post(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode()
        try:
            data = json.loads(body) if body else {}
        except Exception:
            self.send_json(400, {"error": "Invalid JSON body"})
            return

        if self.path == "/api/yt-crawl":
            yt_url = data.get("url", "").strip()
            if not yt_url:
                self.send_json(400, {"error": "Missing YouTube URL"})
                return

            try:
                import yt_dlp
                ydl_opts = {
                    'skip_download': True,
                    'extract_flat': 'in_playlist',
                    'quiet': True,
                    'no_warnings': True
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(yt_url, download=False)

                formats = []
                for f in (info.get("formats", []) or []):
                    if f.get("url") and (f.get("vcodec") != "none" or f.get("acodec") != "none"):
                        note = f.get("format_note", "") or f.get("resolution", "") or f.get("ext", "")
                        size = f.get("filesize", 0) or f.get("filesize_approx", 0) or 0
                        formats.append({
                            "note": str(note),
                            "ext": f.get("ext", "mp4"),
                            "size_mb": round(size / (1024 * 1024), 1) if size else None,
                            "url": f.get("url", "")
                        })

                clean_data = {
                    "title": info.get("title", ""),
                    "id": info.get("id", ""),
                    "channel": info.get("uploader", "") or info.get("channel", ""),
                    "channel_url": info.get("channel_url", ""),
                    "view_count": info.get("view_count", 0),
                    "like_count": info.get("like_count", 0),
                    "duration": info.get("duration", 0),
                    "upload_date": info.get("upload_date", ""),
                    "description": info.get("description", "")[:1000],
                    "tags": info.get("tags", []) or [],
                    "categories": info.get("categories", []) or [],
                    "thumbnail": info.get("thumbnail", ""),
                    "formats": formats[:10]
                }
                self.send_json(200, {"success": True, "data": clean_data})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if self.path == "/api/yt-save-keys":
            keys = data.get("keys", [])
            try:
                import crawler
                crawler.save_api_keys_to_disk(keys)
                self.send_json(200, {"success": True, "message": "API keys saved to ~/.yt_crowler/config.json"})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if self.path == "/api/yt-search":
            mode = data.get("mode", "api")
            search_how = data.get("search_how", "name")
            keyword = data.get("keyword", "").strip()
            category_label = data.get("category_label", "").strip()
            keys = data.get("keys", [])
            try:
                max_results = int(data.get("max_results", 50))
                min_subs = int(data.get("min_subs", 0))
                max_subs_raw = int(data.get("max_subs", 0))
                max_subs = None if max_subs_raw == 0 else max_subs_raw
                min_videos = int(data.get("min_videos", 0))
            except ValueError:
                max_results, min_subs, max_subs, min_videos = 50, 0, None, 0

            country_code = data.get("country_code", None)
            forbid_tiktok = bool(data.get("forbid_tiktok", False))
            forbid_facebook = bool(data.get("forbid_facebook", False))
            exclude_verified = bool(data.get("exclude_verified", False))

            try:
                import crawler, youtube_api_pool
                if mode == "api":
                    if not keys:
                        keys = crawler.load_saved_api_keys()
                    if not keys:
                        keys = ["AIzaSyC-6ZoLhcztyWp3AEYPD19xfV6n0CLZu1M"]

                    pool = youtube_api_pool.YouTubeApiPool(keys)
                    if search_how == "category":
                        cid = crawler.category_id_from_label(category_label)
                        if not cid:
                            self.send_json(400, {"error": f"Unknown category: {category_label}"})
                            return
                        channels = crawler.search_channels_by_category_api(
                            pool,
                            cid,
                            max_results=max_results,
                            min_subs=min_subs,
                            max_subs=max_subs,
                            min_videos=min_videos,
                            forbid_tiktok=forbid_tiktok,
                            forbid_facebook=forbid_facebook,
                            country_code=country_code,
                            exclude_verified=exclude_verified,
                            quiet=True,
                            cache_ttl_sec=90.0,
                        )
                    else:
                        channels = crawler.search_channels(
                            pool,
                            keyword,
                            max_results=max_results,
                            min_subs=min_subs,
                            max_subs=max_subs,
                            min_videos=min_videos,
                            forbid_tiktok=forbid_tiktok,
                            forbid_facebook=forbid_facebook,
                            country_code=country_code,
                            exclude_verified=exclude_verified,
                            quiet=True,
                            cache_ttl_sec=90.0,
                        )
                else:
                    q = category_label if search_how == "category" else keyword
                    channels = crawler.search_channels_ytdlp(
                        q,
                        max_results=max_results,
                        forbid_tiktok=forbid_tiktok,
                        forbid_facebook=forbid_facebook,
                        exclude_verified=exclude_verified,
                        quiet=True,
                    )

                self.send_json(200, {"success": True, "channels": channels, "count": len(channels)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if self.path == "/api/yt-video-crawl":
            url = data.get("url", "").strip()
            if not url:
                self.send_json(400, {"error": "URL required."})
                return
            max_raw = data.get("max_items")
            max_n = int(max_raw) if max_raw else None
            full_meta = bool(data.get("full_meta", False))

            try:
                import crawler
                videos = crawler.crawl(url, max_items=max_n, flat_only=not full_meta)
                self.send_json(200, {"success": True, "videos": videos, "count": len(videos)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if self.path == "/api/auto-deploy":
            try:
                import auto_deploy
                cfg = auto_deploy.load_or_ask_config()
                if not cfg.get("repo") or not cfg.get("token"):
                    self.send_json(400, {"error": "GitHub repo or token not configured yet. Please run ⚡_1_CLICK_DEPLOY.bat first."})
                    return
                # Trigger deploy in thread or synchronously
                success_list = []
                for rel_path in auto_deploy.TRACKED_FILES:
                    ok, msg = auto_deploy.upload_file_to_github(cfg["repo"], rel_path, cfg["token"], cfg.get("branch", "main"))
                    if ok:
                        success_list.append(rel_path)
                self.send_json(200, {
                    "success": True,
                    "synced": len(success_list),
                    "message": f"Successfully pushed {len(success_list)} files to GitHub! Cloudflare is deploying live to khanpro.me."
                })
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if self.path == "/api/send-verification":
            email = data.get("email", "").strip().lower()
            if not email or "@" not in email:
                self.send_json(400, {"error": "Valid email address is required"})
                return

            try:
                url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/email/routing/addresses"
                payload = json.dumps({"email": email}).encode()
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {API_TOKEN}",
                        "Content-Type": "application/json"
                    }
                )
                with urllib.request.urlopen(req) as resp:
                    res_data = json.loads(resp.read().decode())

                self.send_json(200, {
                    "success": True,
                    "email": email,
                    "status": res_data.get("result", {}).get("status", "unverified"),
                    "message": "Verification email sent successfully! Please check your Gmail."
                })
            except urllib.error.HTTPError as err:
                raw_err = err.read().decode()
                try:
                    err_json = json.loads(raw_err)
                    msg = err_json.get("errors", [{}])[0].get("message", "Cloudflare error")
                    if "already exists" in msg.lower() or any(e.get("code") == 2005 for e in err_json.get("errors", [])):
                        self.send_json(200, {
                            "success": True,
                            "alreadyExists": True,
                            "email": email,
                            "message": "Destination address already registered in Cloudflare. Check inbox for verification link."
                        })
                        return
                    self.send_json(400, {"error": msg, "details": err_json})
                except Exception:
                    self.send_json(400, {"error": raw_err})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if self.path == "/api/create-rule":
            alias = data.get("alias", "").strip().lower()
            destination = data.get("destination", "").strip().lower()

            if not alias or not destination:
                self.send_json(400, {"error": "Alias and destination email are required"})
                return

            if not alias.endswith("@khanpro.me"):
                alias = f"{alias}@khanpro.me"

            try:
                url = f"https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/email/routing/rules"
                payload = json.dumps({
                    "name": f"Direct Rule: {alias}",
                    "matchers": [{"type": "literal", "field": "to", "value": alias}],
                    "actions": [{"type": "forward", "value": [destination]}],
                    "enabled": True,
                    "priority": 1
                }).encode()
                req = urllib.request.Request(
                    url,
                    data=payload,
                    headers={
                        "Authorization": f"Bearer {API_TOKEN}",
                        "Content-Type": "application/json"
                    }
                )
                with urllib.request.urlopen(req) as resp:
                    res_data = json.loads(resp.read().decode())

                self.send_json(200, {
                    "success": True,
                    "alias": alias,
                    "destination": destination,
                    "ruleId": res_data.get("result", {}).get("id"),
                    "message": f"Direct forward rule active: {alias} -> {destination}"
                })
            except urllib.error.HTTPError as err:
                raw_err = err.read().decode()
                try:
                    err_json = json.loads(raw_err)
                    msg = err_json.get("errors", [{}])[0].get("message", "Rule creation error")
                    self.send_json(400, {"error": msg, "details": err_json})
                except Exception:
                    self.send_json(400, {"error": raw_err})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        self.send_json(404, {"error": "API route not found"})

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        encoded = json.dumps(data).encode("utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), KhanProHandler) as httpd:
        print(f"[KhanPro Local Proxy] Running on http://localhost:{PORT}")
        httpd.serve_forever()
