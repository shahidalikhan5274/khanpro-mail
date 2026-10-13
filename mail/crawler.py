"""
YouTube tools:
  - crawl: channel/playlist se videos (yt-dlp, API key nahi)
  - search: channels (API key: env, --api-key, ya saved ~/.yt_crowler/config.json)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

import requests
import yt_dlp

from youtube_api_pool import (
    YouTubeApiPool,
    load_api_keys_from_config,
    merge_keys,
    quota_summary_text,
    quota_warning,
)

# YouTube video category id (US) — API "category" search ke liye
VIDEO_CATEGORIES: list[tuple[str, str]] = [
    ("Film & Animation", "1"),
    ("Autos & Vehicles", "2"),
    ("Music", "10"),
    ("Pets & Animals", "15"),
    ("Sports", "17"),
    ("Travel & Events", "19"),
    ("Gaming", "20"),
    ("People & Blogs", "22"),
    ("Comedy", "23"),
    ("Entertainment", "24"),
    ("News & Politics", "25"),
    ("Howto & Style", "26"),
    ("Education", "27"),
    ("Science & Technology", "28"),
    ("Nonprofits & Activism", "29"),
]

CATEGORY_LABEL_BY_ID: dict[str, str] = {cid: label for label, cid in VIDEO_CATEGORIES}

# ISO 3166-1 alpha-2 — channels.list snippet.country (channel ne jo set kiya ho)
CHANNEL_COUNTRY_CHOICES: list[tuple[str, str]] = [
    ("", "Any"),
    ("US", "United States"),
    ("PK", "Pakistan"),
    ("IN", "India"),
    ("GB", "United Kingdom"),
    ("CA", "Canada"),
    ("AU", "Australia"),
    ("DE", "Germany"),
    ("FR", "France"),
    ("ID", "Indonesia"),
    ("BR", "Brazil"),
    ("MX", "Mexico"),
    ("JP", "Japan"),
    ("KR", "South Korea"),
    ("SA", "Saudi Arabia"),
    ("AE", "United Arab Emirates"),
    ("EG", "Egypt"),
    ("NG", "Nigeria"),
    ("TR", "Turkey"),
    ("BD", "Bangladesh"),
    ("PH", "Philippines"),
    ("VN", "Vietnam"),
    ("NL", "Netherlands"),
    ("ES", "Spain"),
    ("IT", "Italy"),
    ("PL", "Poland"),
    ("RU", "Russia"),
    ("CN", "China"),
    ("TW", "Taiwan"),
    ("AR", "Argentina"),
    ("CO", "Colombia"),
    ("ZA", "South Africa"),
    ("MY", "Malaysia"),
    ("TH", "Thailand"),
]


def normalize_channel_country_filter(code: str | None) -> str | None:
    if not code or not str(code).strip():
        return None
    s = str(code).strip().upper()
    return s if len(s) == 2 and s.isalpha() else None


def channel_country_combo_labels() -> list[str]:
    return [label if not code else f"{code} — {label}" for code, label in CHANNEL_COUNTRY_CHOICES]


def parse_channel_country_combo_label(label: str) -> str | None:
    """GUI combobox value -> ISO code ya None (Any)."""
    v = (label or "").strip()
    if not v:
        return None
    for code, name in CHANNEL_COUNTRY_CHOICES:
        if not code:
            if v == name or v.lower() == "any":
                return None
            continue
        if v == f"{code} — {name}" or v.upper() == code:
            return code
    return normalize_channel_country_filter(v)


def _channel_country_passes(channel_country: str | None, want: str | None) -> bool:
    """want set ho to sirf wahi channels jin ka snippet.country match kare (khaali = reject)."""
    if not want:
        return True
    got = (channel_country or "").strip().upper()
    return bool(got) and got == want


def username_from_channel_snippet(snippet: dict[str, Any]) -> str:
    """channels.list snippet.customUrl — display ke liye @handle."""
    if not isinstance(snippet, dict):
        return ""
    raw = snippet.get("customUrl")
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip().lstrip("/")
    if not s:
        return ""
    if s.startswith("@"):
        return s
    return f"@{s}"


def username_from_ytdlp_channel_url(url: str) -> str:
    """yt-dlp kabhi channel_url mein /@handle/ deta hai."""
    if not url or not isinstance(url, str):
        return ""
    m = re.search(r"youtube\.com/@([^/?#]+)", url, re.I)
    if not m:
        return ""
    return f"@{m.group(1)}"


def _channel_badge_verified(channel_id: str, cache: dict[str, bool] | None = None, timeout: float = 12.0) -> bool:
    """
    YouTube Data API verified badge direct nahi deti; channel page HTML badges se check.
    Tokens: BADGE_STYLE_TYPE_VERIFIED / BADGE_STYLE_TYPE_VERIFIED_ARTIST.
    """
    if not channel_id:
        return False
    if cache is not None and channel_id in cache:
        return cache[channel_id]

    is_verified = False
    url = f"https://www.youtube.com/channel/{channel_id}/about"
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code == 200:
            t = r.text
            is_verified = (
                "BADGE_STYLE_TYPE_VERIFIED" in t
                or "BADGE_STYLE_TYPE_VERIFIED_ARTIST" in t
            )
    except requests.RequestException:
        is_verified = False

    if cache is not None:
        cache[channel_id] = is_verified
    return is_verified


def _category_search_q(category_id: str) -> str:
    """
    YouTube search.list ab bina `q` ke aksar khaali items deta hai (API change ~2025).
    Category filter ke saath bhi non-empty `q` zaroori — label se broad query.
    """
    lab = CATEGORY_LABEL_BY_ID.get(category_id, "video")
    q = re.sub(r"[^a-zA-Z0-9\s]+", " ", lab)
    q = re.sub(r"\s+", " ", q).strip().lower()
    return q if q else "video"

# API key save: %USERPROFILE%\.yt_crowler\config.json (plain text — share PC par dhyan rakhein)
def api_key_config_path() -> Path:
    return Path.home() / ".yt_crowler" / "config.json"


def load_saved_api_key() -> str:
    p = api_key_config_path()
    if not p.is_file():
        return ""
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return ""
        return str(data.get("youtube_api_key", "")).strip()
    except (OSError, json.JSONDecodeError, TypeError):
        return ""


def save_api_key(key: str) -> None:
    """Key ko disk par save karo taake baar baar na likhni pade."""
    d = api_key_config_path().parent
    d.mkdir(parents=True, exist_ok=True)
    p = api_key_config_path()
    existing: dict[str, Any] = {}
    if p.is_file():
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                existing = raw
        except (OSError, json.JSONDecodeError):
            existing = {}
    k = key.strip()
    if k:
        existing["youtube_api_key"] = k
        if "youtube_api_keys" not in existing or not isinstance(existing.get("youtube_api_keys"), list):
            existing["youtube_api_keys"] = [k]
    else:
        existing.pop("youtube_api_key", None)
    if existing:
        p.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    elif p.is_file():
        p.unlink()


def clear_saved_api_key() -> None:
    save_api_key("")


def load_saved_api_keys() -> list[str]:
    return load_api_keys_from_config(api_key_config_path())


def save_api_keys_to_disk(keys: list[str]) -> None:
    """Multiple keys (order = priority: pehli dubara try hoti hai)."""
    d = api_key_config_path().parent
    d.mkdir(parents=True, exist_ok=True)
    p = api_key_config_path()
    existing: dict[str, Any] = {}
    if p.is_file():
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                existing = raw
        except (OSError, json.JSONDecodeError):
            existing = {}
    clean = [k.strip() for k in keys if k.strip()]
    if clean:
        existing["youtube_api_keys"] = clean
        existing["youtube_api_key"] = clean[0]
    else:
        existing.pop("youtube_api_keys", None)
        existing.pop("youtube_api_key", None)
    if existing:
        p.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    elif p.is_file():
        p.unlink()


def resolve_api_key(cli_key: str | None = None) -> str:
    """Pehli key (backward compat)."""
    keys = resolve_api_keys(cli_key)
    return keys[0] if keys else ""


def resolve_api_keys(cli_key: str | None = None) -> list[str]:
    """CLI (comma/newline) > env > config file — sab keys order mein."""
    return merge_keys(
        str(cli_key).strip() if cli_key else None,
        os.environ.get("YOUTUBE_API_KEY"),
        api_key_config_path(),
    )


def category_id_from_label(label: str) -> str | None:
    t = label.strip()
    for name, cid in VIDEO_CATEGORIES:
        if name.lower() == t.lower():
            return cid
    return None


def _safe_int_stat(stats: dict[str, Any], key: str, default: int = 0) -> int:
    v = stats.get(key, default)
    if v is None or v == "":
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _statistics_dict(item: dict[str, Any]) -> dict[str, Any]:
    """channels.list kabhi `statistics: null` bhej sakta hai — `.get('statistics', {})` None de deta hai."""
    s = item.get("statistics")
    return s if isinstance(s, dict) else {}


def _subscriber_count_hidden(stats: dict[str, Any] | None) -> bool:
    """YouTube chhupaye hue subs par `subscriberCount` field bhejti hi nahi."""
    if not stats:
        return True
    if "subscriberCount" not in stats:
        return True
    raw = stats.get("subscriberCount")
    return raw is None or raw == ""


def _subs_filters_apply(min_subs: int, max_subs: int | None) -> bool:
    """Min/max subs UI par set hon to chhupe hue count wale channels verify nahi ho sakte — strict mode."""
    if min_subs > 0:
        return True
    if max_subs is not None:
        return True
    return False


def flatten_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "url": entry.get("url") or entry.get("webpage_url"),
        "duration": entry.get("duration"),
        "view_count": entry.get("view_count"),
        "upload_date": entry.get("upload_date"),
        "channel": entry.get("channel") or entry.get("channel_title"),
        "channel_id": entry.get("channel_id"),
    }


def crawl(
    url: str,
    *,
    max_items: int | None = None,
    flat_only: bool = True,
) -> list[dict[str, Any]]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": "in_playlist" if flat_only else False,
    }
    if max_items is not None:
        opts["playlistend"] = max_items

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info:
        return []

    entries = info.get("entries") or []
    if not entries and info.get("id"):
        entries = [info]

    out: list[dict[str, Any]] = []
    for e in entries:
        if not e:
            continue
        if flat_only and e.get("ie_key") == "YoutubeTab" and e.get("entries"):
            for sub in e["entries"]:
                if sub:
                    out.append(flatten_entry(sub) if flat_only else sub)
        else:
            out.append(flatten_entry(e) if flat_only else e)
    return out


def search_channels(
    pool: YouTubeApiPool,
    keyword: str,
    *,
    max_results: int = 200,
    min_subs: int = 0,
    max_subs: int | None = None,
    min_videos: int = 0,
    forbid_tiktok: bool = False,
    forbid_facebook: bool = False,
    country_code: str | None = None,
    exclude_verified: bool = False,
    quiet: bool = False,
    on_channel: Callable[[dict[str, Any]], None] | None = None,
    cache_ttl_sec: float = 120.0,
) -> list[dict[str, Any]]:
    """
    Original ytcrowler.py jaisa flow: search.list + channels.list batch,
    pagination `fetched < max_results` aur `maxResults=min(50, max_results-fetched)`,
    Public subscriberCount par hamesha min/max subs lagu.
    Count chhupa ho aur min_subs>0 ya max_subs set ho to channel skip (filter strict).
    country_code: ISO 3166-1 alpha-2 — channels.list snippet.country se match.
    Sirf `requests` ki jagah YouTubeApiPool (multi-key / retry).
    """
    search_url = "https://www.googleapis.com/youtube/v3/search"
    stats_url = "https://www.googleapis.com/youtube/v3/channels"
    channels: list[dict[str, Any]] = []
    next_page: str | None = None
    fetched = 0
    want_country = normalize_channel_country_filter(country_code)
    verified_cache: dict[str, bool] = {}

    if not quiet:
        cc = want_country or "any"
        print(
            f"Searching '{keyword}' | max {max_results} | "
            f"subs {min_subs}-{max_subs or 'inf'} | min videos {min_videos} | country {cc}",
            file=sys.stderr,
        )

    strict_subs = _subs_filters_apply(min_subs, max_subs)
    while fetched < max_results:
        params: dict[str, Any] = {
            "part": "snippet",
            "q": keyword,
            "type": "channel",
            "maxResults": min(50, max_results - fetched),
        }
        if want_country:
            params["regionCode"] = want_country
        if next_page:
            params["pageToken"] = next_page

        ttl = cache_ttl_sec if cache_ttl_sec > 0 else 0.0
        data, _ = pool.json_request(
            search_url,
            params,
            cache_ttl_sec=ttl,
            quota_log="search",
        )
        items = data.get("items", [])
        if not items:
            break

        channel_ids = [item["id"]["channelId"] for item in items]
        stats_params: dict[str, str] = {
            "part": "snippet,statistics",
            "id": ",".join(channel_ids),
        }
        stats_data, _ = pool.json_request(
            stats_url,
            stats_params,
            cache_ttl_sec=min(90.0, ttl) if ttl > 0 else 0.0,
            quota_log="channels",
        )
        ch_by_id = {item["id"]: item for item in stats_data.get("items", [])}

        for item in items:
            channel_id = item["id"]["channelId"]
            search_snippet = item["snippet"]
            ch = ch_by_id.get(channel_id)
            if not ch:
                continue
            ch_snippet = ch.get("snippet") if isinstance(ch.get("snippet"), dict) else {}
            stats = _statistics_dict(ch)
            country_raw = ch_snippet.get("country") if isinstance(ch_snippet, dict) else None
            if not _channel_country_passes(country_raw, want_country):
                continue

            description = (ch_snippet.get("description") or search_snippet.get("description", "") or "")
            title = ch_snippet.get("title") or search_snippet.get("channelTitle", "")
            thumbs = ch_snippet.get("thumbnails") or search_snippet.get("thumbnails") or {}
            def_thumb = (thumbs.get("default") or {}) if isinstance(thumbs, dict) else {}
            thumb_url = def_thumb.get("url") or ""
            published_at = ch_snippet.get("publishedAt") or search_snippet.get("publishedAt", "")
            username_disp = username_from_channel_snippet(ch_snippet)

            subs_hidden = _subscriber_count_hidden(stats)
            if strict_subs and subs_hidden:
                continue
            subs = 0 if subs_hidden else _safe_int_stat(stats, "subscriberCount", 0)
            videos = _safe_int_stat(stats, "videoCount", 0)

            if not subs_hidden:
                if subs < min_subs:
                    continue
                if max_subs and subs > max_subs:
                    continue
            if videos < min_videos:
                continue
            if forbid_tiktok and re.search(r"tiktok\.com", description.lower()):
                if not quiet:
                    print(f"  skip (tiktok in desc): {title}", file=sys.stderr)
                continue
            if forbid_facebook and re.search(r"facebook\.com", description.lower()):
                if not quiet:
                    print(f"  skip (facebook in desc): {title}", file=sys.stderr)
                continue
            if exclude_verified and _channel_badge_verified(channel_id, verified_cache):
                if not quiet:
                    print(f"  skip (verified): {title}", file=sys.stderr)
                continue

            channel_info: dict[str, Any] = {
                "name": title,
                "username": username_disp,
                "channel_id": channel_id,
                "url": f"https://www.youtube.com/channel/{channel_id}",
                "country": (country_raw or "").strip().upper() or "",
                "subscribers": None if subs_hidden else subs,
                "videos": videos,
                "description": description[:300],
                "thumbnail": thumb_url,
                "published_at": published_at,
            }
            channels.append(channel_info)
            if on_channel:
                on_channel(channel_info)
            if not quiet:
                sub_txt = "hidden" if subs_hidden else f"{subs:,}"
                print(
                    f"  {len(channels)}. {channel_info['name']} "
                    f"(subs {sub_txt}, videos {videos})",
                    file=sys.stderr,
                )

        fetched += len(items)
        next_page = data.get("nextPageToken")
        if not next_page:
            break
        time.sleep(0.3)

    return channels


def search_channels_by_category_api(
    pool: YouTubeApiPool,
    category_id: str,
    *,
    max_results: int = 100,
    min_subs: int = 0,
    max_subs: int | None = None,
    min_videos: int = 0,
    forbid_tiktok: bool = False,
    forbid_facebook: bool = False,
    country_code: str | None = None,
    exclude_verified: bool = False,
    quiet: bool = False,
    on_channel: Callable[[dict[str, Any]], None] | None = None,
    cache_ttl_sec: float = 120.0,
) -> list[dict[str, Any]]:
    """Video search (category) se unique channels; pages tab tak jab tak max_results na mil jayein."""
    search_url = "https://www.googleapis.com/youtube/v3/search"
    stats_url = "https://www.googleapis.com/youtube/v3/channels"
    seen: set[str] = set()
    pending: list[str] = []
    next_page: str | None = None
    channels: list[dict[str, Any]] = []
    ttl = cache_ttl_sec if cache_ttl_sec > 0 else 0.0
    max_search_pages = 80
    want_country = normalize_channel_country_filter(country_code)
    search_region = want_country or "US"
    verified_cache: dict[str, bool] = {}

    if not quiet:
        lab = CATEGORY_LABEL_BY_ID.get(category_id, category_id)
        print(
            f"Category API search '{lab}' (id={category_id}) | max {max_results} channels | "
            f"region {search_region}" + (f" | country filter {want_country}" if want_country else ""),
            file=sys.stderr,
        )

    def _flush_pending() -> None:
        nonlocal pending
        while pending and len(channels) < max_results:
            batch = pending[:50]
            pending = pending[50:]
            stats_params: dict[str, str] = {"part": "snippet,statistics", "id": ",".join(batch)}
            try:
                stats_data, _ = pool.json_request(
                    stats_url,
                    stats_params,
                    cache_ttl_sec=min(90.0, ttl) if ttl > 0 else 0.0,
                    quota_log="channels",
                )
            except RuntimeError as e:
                if not quiet:
                    print(f"channels.list: {e}", file=sys.stderr)
                return
            by_id = {it["id"]: it for it in stats_data.get("items", [])}

            for cid in batch:
                if len(channels) >= max_results:
                    return
                it = by_id.get(cid)
                if not it:
                    continue
                snippet = it.get("snippet", {})
                stats = _statistics_dict(it)
                description = snippet.get("description", "")

                subs_hidden = _subscriber_count_hidden(stats)
                if _subs_filters_apply(min_subs, max_subs) and subs_hidden:
                    continue
                subs = 0 if subs_hidden else _safe_int_stat(stats, "subscriberCount", 0)
                videos = _safe_int_stat(stats, "videoCount", 0)

                if not subs_hidden:
                    if subs < min_subs:
                        continue
                    if max_subs and subs > max_subs:
                        continue
                if videos < min_videos:
                    continue
                if forbid_tiktok and re.search(r"tiktok\.com", description.lower()):
                    continue
                if forbid_facebook and re.search(r"facebook\.com", description.lower()):
                    continue

                country_raw = snippet.get("country")
                if not _channel_country_passes(country_raw, want_country):
                    continue
                if exclude_verified and _channel_badge_verified(cid, verified_cache):
                    continue

                thumbs = snippet.get("thumbnails", {})
                thumb_url = (thumbs.get("default") or {}).get("url", "")
                row = {
                    "name": snippet.get("title", ""),
                    "username": username_from_channel_snippet(snippet),
                    "channel_id": cid,
                    "url": f"https://www.youtube.com/channel/{cid}",
                    "country": ((country_raw or "").strip().upper() if country_raw else ""),
                    "subscribers": None if subs_hidden else subs,
                    "videos": videos,
                    "description": description[:300],
                    "thumbnail": thumb_url,
                    "published_at": snippet.get("publishedAt", ""),
                    "category_id": category_id,
                    "category_label": CATEGORY_LABEL_BY_ID.get(category_id, ""),
                }
                channels.append(row)
                if on_channel:
                    on_channel(row)
                if not quiet:
                    st = "hidden" if subs_hidden else f"{subs:,}"
                    print(f"  {len(channels)}. {row['name']} (subs {st}, videos {videos})", file=sys.stderr)

    for _page in range(max_search_pages):
        if len(channels) >= max_results:
            break
        params: dict[str, Any] = {
            "part": "snippet",
            "type": "video",
            "q": _category_search_q(category_id),
            "videoCategoryId": category_id,
            "maxResults": 50,
            "regionCode": search_region,
        }
        if next_page:
            params["pageToken"] = next_page

        data, _ = pool.json_request(
            search_url,
            params,
            cache_ttl_sec=ttl,
            quota_log="search",
        )
        items = data.get("items", [])
        if not items:
            break

        for item in items:
            cid = item.get("snippet", {}).get("channelId")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            pending.append(cid)

        _flush_pending()
        if len(channels) >= max_results:
            break
        next_page = data.get("nextPageToken")
        if not next_page:
            break
        time.sleep(0.2)

    _flush_pending()
    return channels[:max_results]


def search_channels_ytdlp(
    query: str,
    *,
    max_results: int = 50,
    forbid_tiktok: bool = False,
    forbid_facebook: bool = False,
    exclude_verified: bool = False,
    quiet: bool = False,
    on_channel: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """
    API ke bina: video search (ytsearch) se channel list.
    Subscriber / video count yahan reliable nahi — sirf naam, url, sample description.
    """
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    variants = [query, f"{query} channel", f"{query} official"]
    vidx = 0
    batch_no = 0
    max_batches = 12
    verified_cache: dict[str, bool] = {}

    while len(out) < max_results and batch_no < max_batches:
        q = variants[vidx % len(variants)]
        vidx += 1
        n = min(50, max(15, (max_results - len(out)) * 3))
        url = f"ytsearch{n}:{q}"
        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "ignoreerrors": True,
            "extract_flat": True,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            if not quiet:
                print(f"yt-dlp search error: {e}", file=sys.stderr)
            break

        entries = (info or {}).get("entries") or []
        added_this = 0
        for e in entries:
            if not e:
                continue
            cid = e.get("channel_id")
            if not cid or cid in seen:
                continue
            desc = (e.get("description") or "")[:300]
            if forbid_tiktok and re.search(r"tiktok\.com", desc.lower()):
                continue
            if forbid_facebook and re.search(r"facebook\.com", desc.lower()):
                continue
            if exclude_verified and _channel_badge_verified(cid, verified_cache):
                continue
            seen.add(cid)
            thumbs = e.get("thumbnails") or []
            thumb_url = thumbs[0]["url"] if thumbs else ""
            chan_url = e.get("channel_url") or f"https://www.youtube.com/channel/{cid}"
            row = {
                "name": e.get("channel") or e.get("uploader") or "",
                "username": username_from_ytdlp_channel_url(chan_url),
                "channel_id": cid,
                "url": chan_url,
                "country": "",
                "subscribers": "",
                "videos": "",
                "description": desc,
                "thumbnail": thumb_url,
                "published_at": "",
                "sample_video": e.get("title") or "",
            }
            out.append(row)
            if on_channel:
                on_channel(row)
            added_this += 1
            if len(out) >= max_results:
                break
            if not quiet:
                print(f"  {len(out)}. {out[-1]['name']}", file=sys.stderr)

        batch_no += 1
        if added_this == 0:
            break
        time.sleep(0.2)

    return out


def write_json(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: ("" if row.get(k) is None else row[k]) for k in fieldnames})


def write_channel_search_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    """Export: pehle name + username (@handle), phir baaki columns."""
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    preferred = [
        "name",
        "username",
        "channel_id",
        "url",
        "country",
        "subscribers",
        "videos",
        "description",
        "thumbnail",
        "published_at",
        "category_id",
        "category_label",
        "sample_video",
    ]
    all_keys: set[str] = set()
    for r in rows:
        all_keys.update(r.keys())
    fieldnames = ["name", "username"]
    for k in preferred[2:]:
        if k in all_keys:
            fieldnames.append(k)
    fieldnames.extend(sorted(k for k in all_keys if k not in fieldnames))
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow({k: ("" if row.get(k) is None else row.get(k, "")) for k in fieldnames})


def _emit_rows(rows: list[dict[str, Any]], output: Path | None) -> None:
    if output:
        suffix = output.suffix.lower()
        if suffix == ".csv":
            if rows and isinstance(rows[0], dict) and "channel_id" in rows[0] and "url" in rows[0]:
                write_channel_search_csv(output, rows)
            else:
                write_csv(output, rows)
        else:
            write_json(output, rows)
        print(f"Saved {len(rows)} rows -> {output}", file=sys.stderr)
    else:
        print(json.dumps(rows, ensure_ascii=False, indent=2))


def cmd_crawl(args: argparse.Namespace) -> int:
    try:
        rows = crawl(args.url, max_items=args.max, flat_only=not args.full)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    _emit_rows(rows, args.output)
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    name_q = (args.name or args.keyword or "").strip()
    cat_label = (args.category or "").strip()
    if not name_q and not cat_label:
        print("Search ke liye naam (--name / keyword) ya --category do.", file=sys.stderr)
        return 1
    if name_q and cat_label:
        print("Sirf ek chuno: naam ya category.", file=sys.stderr)
        return 1

    if args.no_api:
        query = cat_label if cat_label else name_q
        rows = search_channels_ytdlp(
            query,
            max_results=args.max_results,
            forbid_tiktok=args.forbid_tiktok,
            forbid_facebook=args.forbid_facebook,
            exclude_verified=args.exclude_verified,
            quiet=args.quiet,
        )
        if rows and not args.quiet:
            print("\n(No API) Subscriber count nahi — sirf channel list.", file=sys.stderr)
        _emit_rows(rows, args.output)
        return 0

    keys = resolve_api_keys(args.api_key)
    if not keys:
        print(
            "API mode: --api-key (comma / newline), env, saved keys, ya --no-api.",
            file=sys.stderr,
        )
        return 1

    cache_ttl = 0.0 if getattr(args, "no_api_cache", False) else 120.0
    pool = YouTubeApiPool(keys)
    if not args.quiet:
        qw = quota_warning(keys)
        if qw:
            print(qw, file=sys.stderr)
        qs = quota_summary_text(keys)
        if qs:
            print(f"Quota estimate (aaj): {qs}", file=sys.stderr)

    if cat_label:
        cid = category_id_from_label(cat_label)
        if not cid:
            print(f"Unknown category label: {cat_label!r}. List: " + ", ".join(x[0] for x in VIDEO_CATEGORIES), file=sys.stderr)
            return 1
        try:
            rows = search_channels_by_category_api(
                pool,
                cid,
                max_results=args.max_results,
                min_subs=args.min_subs,
                max_subs=args.max_subs,
                min_videos=args.min_videos,
                forbid_tiktok=args.forbid_tiktok,
                forbid_facebook=args.forbid_facebook,
                country_code=normalize_channel_country_filter(getattr(args, "country", None)),
                exclude_verified=args.exclude_verified,
                quiet=args.quiet,
                cache_ttl_sec=cache_ttl,
            )
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            return 1
    else:
        try:
            rows = search_channels(
                pool,
                name_q,
                max_results=args.max_results,
                min_subs=args.min_subs,
                max_subs=args.max_subs,
                min_videos=args.min_videos,
                forbid_tiktok=args.forbid_tiktok,
                forbid_facebook=args.forbid_facebook,
                country_code=normalize_channel_country_filter(getattr(args, "country", None)),
                exclude_verified=args.exclude_verified,
                quiet=args.quiet,
                cache_ttl_sec=cache_ttl,
            )
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            return 1

    if rows and not args.quiet:
        def _subs(ch: dict[str, Any]) -> int:
            s = ch.get("subscribers", 0)
            return int(s) if isinstance(s, int) else 0

        top = sorted(rows, key=_subs, reverse=True)[:5]
        print("\nTop 5 by subscribers:", file=sys.stderr)
        for i, ch in enumerate(top, 1):
            s = ch.get("subscribers")
            st = f"{s:,}" if isinstance(s, int) else "hidden"
            print(
                f"  {i}. {ch['name']} — {st} subs, {ch.get('videos', '?')} videos",
                file=sys.stderr,
            )

    _emit_rows(rows, args.output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="YouTube: video crawl (yt-dlp) ya channel search (API).")
    sub = p.add_subparsers(dest="command", required=True)

    pc = sub.add_parser("crawl", help="Channel/playlist URL se videos list")
    pc.add_argument("url", help="Channel ya playlist URL")
    pc.add_argument("-n", "--max", type=int, default=None, metavar="N", help="Pehli N videos")
    pc.add_argument("-o", "--output", type=Path, default=None, help=".json ya .csv")
    pc.add_argument("--full", action="store_true", help="Poora yt-dlp metadata")
    pc.set_defaults(_run=cmd_crawl)

    ps = sub.add_parser("search", help="Channels: naam se ya category se (API ya --no-api)")
    ps.add_argument(
        "keyword",
        nargs="?",
        default=None,
        help="Naam / keyword (optional agar --category ho)",
    )
    ps.add_argument("--name", default=None, help="Search by name (keyword)")
    ps.add_argument(
        "--category",
        metavar="LABEL",
        default=None,
        help='Category label, e.g. "Gaming", "Music" (API: video category id)',
    )
    ps.add_argument(
        "--no-api",
        action="store_true",
        help="yt-dlp video search se channels (key nahi; subs filter kaam nahi)",
    )
    ps.add_argument(
        "--max-results",
        type=int,
        default=100,
        metavar="N",
        help="Max channels to fetch (default 100)",
    )
    ps.add_argument("--min-subs", type=int, default=0, help="Minimum subscribers")
    ps.add_argument(
        "--max-subs",
        type=int,
        default=None,
        metavar="N",
        help="Maximum subscribers (omit for no max)",
    )
    ps.add_argument("--min-videos", type=int, default=0, help="Minimum video count")
    ps.add_argument(
        "--country",
        metavar="XX",
        default=None,
        help="Channel country (ISO 3166-1 alpha-2), e.g. PK, US — channels.list snippet.country",
    )
    ps.add_argument(
        "--forbid-tiktok",
        action="store_true",
        help="Skip jab description mein tiktok.com ho",
    )
    ps.add_argument(
        "--forbid-facebook",
        action="store_true",
        help="Skip jab description mein facebook.com ho",
    )
    ps.add_argument(
        "--exclude-verified",
        action="store_true",
        help="Verified channels skip karein (badge HTML heuristic; official API flag nahi)",
    )
    ps.add_argument(
        "--api-key",
        default=None,
        help="Ek ya zyada keys (comma ya file); warna env / ~/.yt_crowler/config.json",
    )
    ps.add_argument(
        "--no-api-cache",
        action="store_true",
        help="Short TTL cache band (har baar taaza API)",
    )
    ps.add_argument("-o", "--output", type=Path, default=None, help=".json ya .csv")
    ps.add_argument("-q", "--quiet", action="store_true", help="Kam console output")
    ps.set_defaults(_run=cmd_search)

    return p


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    # Sirf `python crawler.py` — subcommand na ho to desktop GUI khol do
    if len(sys.argv) <= 1:
        gui_path = Path(__file__).resolve().parent / "gui.py"
        if gui_path.is_file():
            print("Desktop GUI khul raha hai... (alag se: python gui.py)")
            subprocess.Popen(
                [sys.executable, str(gui_path)],
                cwd=str(gui_path.parent),
                close_fds=sys.platform != "win32",
            )
            return 0
        print("gui.py nahi mila. Ye commands use karein:", file=sys.stderr)
        print("  python crawler.py crawl <channel_ya_playlist_URL> [-n 50] [-o out.json]", file=sys.stderr)
        print("  python crawler.py search <keyword> [--no-api] [-o out.csv]", file=sys.stderr)
        return 1
    args = build_parser().parse_args()
    return args._run(args)


if __name__ == "__main__":
    raise SystemExit(main())
