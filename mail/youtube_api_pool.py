"""
YouTube Data API: multi-key rotation, retries, short TTL cache, quota estimate.
Har nayi search / CLI run pe pehli key se shuru; quota fail par agli key; pehli phir se try hoti rahegi.
"""

from __future__ import annotations

import hashlib
import json
import random
import time
from pathlib import Path
from typing import Any

import requests

# Google documented costs (units per call)
UNITS_SEARCH_LIST = 100
UNITS_CHANNELS_LIST = 1
DEFAULT_DAILY_CAP = 10_000

CONFIG_DIR = Path.home() / ".yt_crowler"
CACHE_DIR = CONFIG_DIR / "api_cache"


def _key_fingerprint(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]


def _today_str() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def load_api_keys_from_config(config_path: Path) -> list[str]:
    if not config_path.is_file():
        return []
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    keys: list[str] = []
    raw_list = data.get("youtube_api_keys")
    if isinstance(raw_list, list):
        for x in raw_list:
            s = str(x).strip()
            if s and s not in keys:
                keys.append(s)
    one = str(data.get("youtube_api_key", "")).strip()
    if one and one not in keys:
        keys.insert(0, one)
    return keys


def merge_keys(cli: str | None, env: str | None, config_path: Path) -> list[str]:
    out: list[str] = []
    if cli and cli.strip():
        for part in re_split_keys(cli):
            if part not in out:
                out.append(part)
    if not out and env and env.strip():
        for part in re_split_keys(env):
            if part not in out:
                out.append(part)
    if not out:
        out = load_api_keys_from_config(config_path)
    return out


def re_split_keys(s: str) -> list[str]:
    s = s.strip()
    if not s:
        return []
    if "," in s:
        return [p.strip() for p in s.split(",") if p.strip()]
    if "\n" in s:
        return [p.strip() for p in s.splitlines() if p.strip()]
    return [s]


def quota_usage_path() -> Path:
    return CONFIG_DIR / f"quota_{_today_str()}.json"


def load_quota_state() -> dict[str, Any]:
    p = quota_usage_path()
    if not p.is_file():
        return {}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_quota_state(state: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    quota_usage_path().write_text(json.dumps(state, indent=2), encoding="utf-8")


def record_units(api_key: str, units: int) -> None:
    if units <= 0:
        return
    fp = _key_fingerprint(api_key)
    st = load_quota_state()
    entry = st.get(fp)
    if not isinstance(entry, dict):
        entry = {"search": 0, "channels": 0, "units_est": 0}
    entry["units_est"] = int(entry.get("units_est", 0)) + units
    st[fp] = entry
    save_quota_state(st)


def record_search_call(api_key: str) -> None:
    record_units(api_key, UNITS_SEARCH_LIST)


def record_channels_call(api_key: str) -> None:
    record_units(api_key, UNITS_CHANNELS_LIST)


def quota_summary_text(keys: list[str], daily_cap: int = DEFAULT_DAILY_CAP) -> str:
    st = load_quota_state()
    lines = []
    for i, k in enumerate(keys, 1):
        fp = _key_fingerprint(k)
        u = int((st.get(fp) or {}).get("units_est", 0)) if isinstance(st.get(fp), dict) else 0
        pct = min(100, int(100 * u / daily_cap)) if daily_cap else 0
        lines.append(f"Key {i}: ~{u}/{daily_cap} units ({pct}%)")
    return " | ".join(lines) if lines else ""


def quota_warning(keys: list[str], daily_cap: int = DEFAULT_DAILY_CAP) -> str | None:
    st = load_quota_state()
    warns = []
    for i, k in enumerate(keys, 1):
        fp = _key_fingerprint(k)
        u = int((st.get(fp) or {}).get("units_est", 0)) if isinstance(st.get(fp), dict) else 0
        if u >= int(daily_cap * 0.95):
            warns.append(
                f"Key {i}: quota lagbhag poori (~{u} units). "
                f"EN: Daily limit almost reached. Agli key use ho rahi ho to theek."
            )
        elif u >= int(daily_cap * 0.80):
            warns.append(
                f"Key {i}: ~{u}/{daily_cap} units (80%+). "
                f"EN: Slow down or use backup API key."
            )
    return "\n".join(warns) if warns else None


def _cache_path(url: str, params: dict[str, Any]) -> Path:
    key = json.dumps({"u": url, "p": params}, sort_keys=True, ensure_ascii=False)
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{h}.json"


def cache_get(url: str, params: dict[str, Any], ttl_sec: float) -> dict[str, Any] | None:
    p = _cache_path(url, params)
    if not p.is_file():
        return None
    try:
        wrap = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(wrap, dict) or "t" not in wrap or "data" not in wrap:
            return None
        if time.time() - float(wrap["t"]) > ttl_sec:
            p.unlink(missing_ok=True)
            return None
        data = wrap["data"]
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None


def cache_set(url: str, params: dict[str, Any], data: dict[str, Any]) -> None:
    try:
        p = _cache_path(url, params)
        p.write_text(
            json.dumps({"t": time.time(), "data": data}, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError:
        pass


def parse_api_error(resp: requests.Response) -> tuple[str | None, str]:
    """(reason_code, human message UR+EN)"""
    try:
        j = resp.json()
    except (json.JSONDecodeError, ValueError):
        return None, f"HTTP {resp.status_code} — network/server error / jaari response."
    err = j.get("error") if isinstance(j, dict) else None
    if not isinstance(err, dict):
        return None, f"HTTP {resp.status_code} — maloom error format."
    msg = err.get("message", "") or ""
    errors = err.get("errors")
    reason = None
    if isinstance(errors, list) and errors:
        e0 = errors[0] if isinstance(errors[0], dict) else {}
        reason = e0.get("reason")
    ru = {
        "quotaExceeded": "Quota khatam / limit. EN: API quota exceeded — agli key try ho rahi hai.",
        "dailyLimitExceeded": "Rozana limit. EN: Daily limit exceeded.",
        "rateLimitExceeded": "Bohot tez requests. EN: Rate limited — thodi der baad dubara.",
        "keyInvalid": "API key galat. EN: Invalid API key.",
        "keyExpired": "API key expire. EN: API key expired.",
        "accessNotConfigured": "YouTube API enable karein Console mein. EN: Enable YouTube Data API v3 in Google Cloud.",
        "forbidden": "Ijazat nahi. EN: Forbidden — check API restrictions.",
    }
    human = ru.get(str(reason), msg or f"HTTP {resp.status_code}")
    return str(reason) if reason else None, human


def is_quota_reason(reason: str | None) -> bool:
    return reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded")


class YouTubeApiPool:
    """Har request pe keys 0..N try; network par retry; quota par agli key."""

    def __init__(self, keys: list[str], *, session: requests.Session | None = None) -> None:
        self.keys = [k.strip() for k in keys if k.strip()]
        self._session = session or requests.Session()

    def json_request(
        self,
        url: str,
        params_base: dict[str, Any],
        *,
        timeout: float = 35.0,
        retries_per_key: int = 3,
        cache_ttl_sec: float = 0.0,
        quota_log: str | None = None,
    ) -> tuple[dict[str, Any], str]:
        """Returns (response_json, api_key_used). Raises RuntimeError with Urdu/English message.
        quota_log: \"search\" | \"channels\" — successful call par units file mein likhte hain.
        """
        params_for_cache = {k: v for k, v in params_base.items() if k != "key"}
        if cache_ttl_sec > 0:
            hit = cache_get(url, params_for_cache, cache_ttl_sec)
            if hit is not None:
                return hit, self.keys[0] if self.keys else ""

        if not self.keys:
            raise RuntimeError("Koi API key nahi. EN: No API keys configured.")

        last_err = ""
        for api_key in self.keys:
            params = {**params_base, "key": api_key}
            for attempt in range(retries_per_key):
                try:
                    resp = self._session.get(url, params=params, timeout=timeout)
                except requests.RequestException as e:
                    last_err = (
                        f"Network error (try {attempt + 1}/{retries_per_key}): {e}. "
                        f"EN: Check internet; retrying."
                    )
                    time.sleep(0.4 * (2**attempt) + random.random() * 0.2)
                    continue

                if resp.status_code == 200:
                    try:
                        data = resp.json()
                    except json.JSONDecodeError as e:
                        last_err = f"JSON parse error: {e}"
                        break
                    if not isinstance(data, dict):
                        raise RuntimeError("API ne invalid JSON diya. EN: Invalid API response.")
                    if quota_log == "search":
                        record_search_call(api_key)
                    elif quota_log == "channels":
                        record_channels_call(api_key)
                    if cache_ttl_sec > 0:
                        cache_set(url, params_for_cache, data)
                    return data, api_key

                reason, human = parse_api_error(resp)
                last_err = human
                if is_quota_reason(reason):
                    break  # next API key
                if resp.status_code in (500, 502, 503, 504):
                    time.sleep(0.5 * (2**attempt) + random.random() * 0.3)
                    continue
                raise RuntimeError(human)

        raise RuntimeError(
            last_err
            or "Tamam API keys fail. EN: All API keys failed (quota / network). "
            "Kal dubara try karein ya nayi keys lagayein."
        )
