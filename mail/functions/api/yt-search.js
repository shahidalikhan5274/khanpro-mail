/**
 * Cloudflare Pages Function: /api/yt-search
 * Edge API endpoint for searching YouTube channels using YouTube Data API v3 key pool
 */
export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const data = await context.request.json();
    const keys = Array.isArray(data.keys) ? data.keys.filter(Boolean) : [];
    const searchHow = data.search_how || 'name';
    const keyword = (data.keyword || '').trim();
    const categoryLabel = (data.category_label || '').trim();
    const maxResults = Math.min(parseInt(data.max_results) || 50, 500);
    const minSubs = parseInt(data.min_subs) || 0;
    const maxSubs = parseInt(data.max_subs) || 0;
    const minVideos = parseInt(data.min_videos) || 0;
    const countryCode = (data.country_code || '').trim().toUpperCase();

    if (!keys.length) {
      return new Response(JSON.stringify({ error: 'API key is required in keys array.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const key = keys[0];
    const q = searchHow === 'category' ? categoryLabel.toLowerCase() : keyword;
    if (!q) {
      return new Response(JSON.stringify({ error: 'Keyword or category required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Query YouTube search API
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(q)}&maxResults=${Math.min(maxResults, 50)}&key=${key}`;
    const sRes = await fetch(searchUrl);
    const sData = await sRes.json();

    if (sData.error) {
      return new Response(JSON.stringify({ error: sData.error.message || 'YouTube Data API error' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const channelIds = (sData.items || []).map(it => it.snippet?.channelId || it.id?.channelId).filter(Boolean);
    if (!channelIds.length) {
      return new Response(JSON.stringify({ success: true, channels: [], count: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Query channel statistics
    const detailsUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${key}`;
    const dRes = await fetch(detailsUrl);
    const dData = await dRes.json();

    let channels = (dData.items || []).map(ch => {
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

    // Step 3: Apply filters
    channels = channels.filter(c => {
      if (minSubs > 0 && (c.subscribers === null || c.subscribers < minSubs)) return false;
      if (maxSubs > 0 && c.subscribers !== null && c.subscribers > maxSubs) return false;
      if (minVideos > 0 && c.videos < minVideos) return false;
      if (countryCode && c.country.toUpperCase() !== countryCode) return false;
      return true;
    });

    return new Response(JSON.stringify({ success: true, channels, count: channels.length }), {
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
