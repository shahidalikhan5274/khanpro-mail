"""
Interactive channel search — tumhare original ytcrowler flow jaisa (sirf API keys / pool naya).
"""

from __future__ import annotations

import sys
from pathlib import Path

from crawler import (
    VIDEO_CATEGORIES,
    category_id_from_label,
    normalize_channel_country_filter,
    resolve_api_keys,
    save_api_keys_to_disk,
    search_channels,
    search_channels_by_category_api,
    write_channel_search_csv,
)
from youtube_api_pool import YouTubeApiPool, quota_summary_text, quota_warning


def main() -> None:
    print("\n" + "=" * 60)
    print("YouTube channel search (Data API v3)")
    print("=" * 60)

    keys = resolve_api_keys(None)
    if not keys:
        one = input("YouTube API key (pehli key; zyada ke liye GUI use karein): ").strip()
        if one:
            keys = [one]
            if input("Is key ko save karun? (y/n): ").strip().lower() == "y":
                save_api_keys_to_disk(keys)
                print("Save ho gaya.")
    if not keys:
        print("API key required.", file=sys.stderr)
        sys.exit(1)

    qw = quota_warning(keys)
    if qw:
        print(qw)
    print(quota_summary_text(keys))

    pool = YouTubeApiPool(keys)

    print("\nSearch mode: (k) keyword — jaise purana script  |  (c) category — GUI jaisa")
    mode = (input("Mode [k]: ").strip() or "k").lower()
    keyword = ""
    category_label = ""
    if mode.startswith("c"):
        print("\nCategories:")
        for i, (name, _cid) in enumerate(VIDEO_CATEGORIES, 1):
            print(f"  {i:2}. {name}")
        raw = input("Number ya exact name (e.g. Gaming): ").strip()
        if raw.isdigit():
            idx = int(raw) - 1
            if 0 <= idx < len(VIDEO_CATEGORIES):
                category_label = VIDEO_CATEGORIES[idx][0]
        if not category_label:
            category_label = raw
        cid = category_id_from_label(category_label)
        if not cid:
            print("Category samajh nahi aayi. List se number ya naam likho.", file=sys.stderr)
            sys.exit(1)
        category_label = next(n for n, c in VIDEO_CATEGORIES if c == cid)
    else:
        keyword = input("Keyword (e.g. food, gaming): ").strip()
        if not keyword:
            print("Keyword required.", file=sys.stderr)
            sys.exit(1)

    try:
        min_subs = int(input("Minimum subscribers (0 = no min): ") or "0")
        max_subs_raw = input("Maximum subscribers (0 = no max): ").strip()
        max_subs = int(max_subs_raw) if max_subs_raw and max_subs_raw != "0" else None
        min_videos = int(input("Minimum videos (0 = no min): ") or "0")
        max_results = int(input("Max channels to fetch (0 = 500): ") or "100")
        if max_results == 0:
            max_results = 500
    except ValueError:
        print("Invalid number, using defaults: min_subs=0, no max_subs, min_videos=0, max_results=100")
        min_subs, max_subs, min_videos, max_results = 0, None, 0, 100

    print("\n--- Description filters ---")
    forbid_tiktok = input("Exclude channels with tiktok.com in description? (y/n): ").strip().lower() == "y"
    forbid_facebook = input("Exclude channels with facebook.com in description? (y/n): ").strip().lower() == "y"
    exclude_verified = input("Exclude verified channels? (y/n): ").strip().lower() == "y"

    cc_in = input("Channel country — ISO2 jaise PK, US (Enter = koi filter nahi): ").strip()
    country_f = normalize_channel_country_filter(cc_in) if cc_in else None
    if cc_in and not country_f:
        print("Country code 2 letters hona chahiye; filter ignore.", file=sys.stderr)

    try:
        if mode.startswith("c"):
            channels = search_channels_by_category_api(
                pool,
                cid,
                max_results=max_results,
                min_subs=min_subs,
                max_subs=max_subs,
                min_videos=min_videos,
                forbid_tiktok=forbid_tiktok,
                forbid_facebook=forbid_facebook,
                country_code=country_f,
                exclude_verified=exclude_verified,
                quiet=False,
                cache_ttl_sec=120.0,
            )
        else:
            channels = search_channels(
                pool,
                keyword,
                max_results=max_results,
                min_subs=min_subs,
                max_subs=max_subs,
                min_videos=min_videos,
                forbid_tiktok=forbid_tiktok,
                forbid_facebook=forbid_facebook,
                country_code=country_f,
                exclude_verified=exclude_verified,
                quiet=False,
                cache_ttl_sec=120.0,
            )
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    print(f"\nTotal after filters: {len(channels)}")
    if not channels:
        print("No channels matched. Try lowering filters.")
        return

    def _subs_key(ch: dict) -> int:
        s = ch.get("subscribers")
        return int(s) if isinstance(s, int) else 0

    sorted_ch = sorted(channels, key=_subs_key, reverse=True)
    print("\nTop 5 by subscribers:")
    for i, ch in enumerate(sorted_ch[:5], 1):
        s = ch.get("subscribers")
        st = f"{s:,}" if isinstance(s, int) else "hidden"
        print(f"  {i}. {ch['name']} — {st} subs — {ch['videos']} videos")

    out = input("\nCSV filename [youtube_channels.csv]: ").strip() or "youtube_channels.csv"
    write_channel_search_csv(Path(out), channels)
    print(f"Saved {len(channels)} channels -> {out}")


if __name__ == "__main__":
    main()
