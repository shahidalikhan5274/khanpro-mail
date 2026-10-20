/**
 * Cloudflare Pages Function: /api/yt-search
 * Hybrid YouTube Channel Search Engine:
 * 1. Direct Web Scraper (Free & Unlimited, No API Key Required)
 * 2. Official YouTube Data API v3 (when user provides key)
 */

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const data = await context.request.json();
    const mode = data.mode || 'noapi';
    const keys = Array.isArray(data.keys) ? data.keys.filter(Boolean) : [];
    const searchHow = data.search_how || 'name';
    const keyword = (data.keyword || '').trim();
    const categoryLabel = (data.category_label || '').trim();
    const maxResults = Math.min(Math.max(parseInt(data.max_results) || 50, 1), 500);
    const minSubs = parseInt(data.min_subs) || 0;
    const maxSubs = parseInt(data.max_subs) || 0;
    const minVideos = parseInt(data.min_videos) || 0;
    const countryCode = (data.country_code || '').trim().toUpperCase();
    const forbidTiktok = Boolean(data.forbid_tiktok);
    const forbidFacebook = Boolean(data.forbid_facebook);
    const excludeVerified = Boolean(data.exclude_verified);

    const q = searchHow === 'category' ? (categoryLabel || keyword) : keyword;
    if (!q) {
      return new Response(JSON.stringify({ error: 'Search ke liye keyword ya category likhein.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let channels = null;

    // Option A: If user provided Google Data API key and selected API mode
    if (mode === 'api' && keys.length > 0) {
      for (const key of keys) {
        try {
          const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=${Math.min(maxResults, 50)}&key=${key}`;
          const sRes = await fetch(searchUrl);
          const sData = await sRes.json();

          if (sData.error) {
            console.warn('YouTube Data API key error, trying next/fallback:', sData.error.message);
            continue;
          }

          const channelIds = (sData.items || []).map(it => it.snippet?.channelId || it.id?.channelId).filter(Boolean);
          if (channelIds.length === 0) {
            channels = [];
            break;
          }

          const detailsUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${key}`;
          const dRes = await fetch(detailsUrl);
          const dData = await dRes.json();

          channels = (dData.items || []).map(ch => {
            const snip = ch.snippet || {};
            const stat = ch.statistics || {};
            const subs = stat.hiddenSubscriberCount ? null : parseInt(stat.subscriberCount || '0');
            const vids = parseInt(stat.videoCount || '0');
            const country = snip.country || '';
            const uname = snip.customUrl ? (snip.customUrl.startsWith('@') ? snip.customUrl : '@' + snip.customUrl) : '';
            return {
              id: ch.id,
              name: snip.title || '',
              username: uname,
              country: country,
              subscribers: subs,
              videos: vids,
              url: `https://www.youtube.com/channel/${ch.id}`,
            };
          });
          break; // successfully fetched
        } catch (e) {
          console.warn('API fetch error:', e.message);
        }
      }
    }

    // Option B: Direct Web Engine (Scrape YouTube channel search directly)
    if (!channels || channels.length === 0) {
      try {
        const scrapeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D`;
        const yRes = await fetch(scrapeUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });

        if (yRes.ok) {
          const html = await yRes.text();
          let jsonStr = '';
          const m1 = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/);
          const m2 = html.match(/window\["ytInitialData"\]\s*=\s*({.+?});<\/script>/);
          if (m1) jsonStr = m1[1];
          else if (m2) jsonStr = m2[1];

          if (jsonStr) {
            const ytData = JSON.parse(jsonStr);
            const foundChannels = [];

            function parseCount(text) {
              if (!text) return 0;
              const clean = String(text).toLowerCase().replace(/,/g, '');
              const m = clean.match(/([\d.]+)\s*([kmb])?/);
              if (!m) return 0;
              let num = parseFloat(m[1]);
              const unit = m[2];
              if (unit === 'k') num *= 1000;
              else if (unit === 'm') num *= 1000000;
              else if (unit === 'b') num *= 1000000000;
              return Math.round(num);
            }

            function scanChannels(obj) {
              if (!obj || typeof obj !== 'object') return;
              if (obj.channelRenderer) {
                const cr = obj.channelRenderer;
                const cid = cr.channelId;
                const title = cr.title?.simpleText || cr.title?.runs?.[0]?.text || '';
                const nav = cr.navigationEndpoint?.browseEndpoint || {};
                const handle = nav.canonicalBaseUrl || cr.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';

                const t1 = cr.subscriberCountText?.simpleText || '';
                const t2 = cr.videoCountText?.simpleText || cr.videoCountText?.accessibility?.accessibilityData?.label || '';

                let subsText = '';
                let vidsText = '';
                let uname = handle ? handle.replace(/^\//, '') : '';

                for (const t of [t1, t2]) {
                  if (!t) continue;
                  if (t.toLowerCase().includes('sub')) subsText = t;
                  else if (t.toLowerCase().includes('vid')) vidsText = t;
                  else if (t.startsWith('@') && !uname) uname = t;
                }

                const subsNum = parseCount(subsText);
                const vidsNum = parseCount(vidsText);

                let isVerified = false;
                if (Array.isArray(cr.ownerBadges)) {
                  isVerified = cr.ownerBadges.some(b => 
                    b.metadataBadgeRenderer?.tooltip === 'Verified' || 
                    b.metadataBadgeRenderer?.style?.includes('VERIFIED')
                  );
                }

                const desc = (cr.descriptionSnippet?.runs || []).map(r => r.text || '').join('');
                const channelUrl = handle 
                  ? `https://www.youtube.com${handle.startsWith('/') ? handle : '/' + handle}` 
                  : `https://www.youtube.com/channel/${cid}`;

                foundChannels.push({
                  id: cid,
                  name: title,
                  username: uname ? (uname.startsWith('@') ? uname : '@' + uname) : '',
                  country: '',
                  subscribers: subsNum,
                  subscribersText: subsText,
                  videos: vidsNum,
                  videosText: vidsText,
                  verified: isVerified,
                  description: desc,
                  url: channelUrl
                });
              }

              if (Array.isArray(obj)) {
                for (const it of obj) scanChannels(it);
              } else {
                for (const k in obj) {
                  if (Object.prototype.hasOwnProperty.call(obj, k)) {
                    scanChannels(obj[k]);
                  }
                }
              }
            }

            scanChannels(ytData);
            if (foundChannels.length > 0) {
              channels = foundChannels;
            }
          }
        }
      } catch (err) {
        console.warn('Direct web search error:', err.message);
      }
    }

    if (!channels) channels = [];

    // Filter results
    let filtered = channels.filter(c => {
      if (minSubs > 0 && c.subscribers !== null && c.subscribers < minSubs) return false;
      if (maxSubs > 0 && c.subscribers !== null && c.subscribers > maxSubs) return false;
      if (minVideos > 0 && c.videos !== null && c.videos < minVideos) return false;
      if (countryCode && c.country && c.country.toUpperCase() !== countryCode) return false;
      if (excludeVerified && c.verified) return false;
      if (forbidTiktok && (c.description || '').toLowerCase().includes('tiktok.com')) return false;
      if (forbidFacebook && (c.description || '').toLowerCase().includes('facebook.com')) return false;
      return true;
    });

    if (filtered.length > maxResults) {
      filtered = filtered.slice(0, maxResults);
    }

    return new Response(JSON.stringify({
      success: true,
      channels: filtered,
      count: filtered.length,
      mode: mode
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal edge error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
