/**
 * Cloudflare Pages Function: /api/list-destinations
 * Returns destination addresses list and verification status
 */
export async function onRequestGet(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const ACCOUNT_ID = context.env.CF_ACCOUNT_ID;
    const API_TOKEN = context.env.CF_API_TOKEN;

    if (!API_TOKEN || !ACCOUNT_ID) {
      return new Response(JSON.stringify({ error: 'Cloudflare credentials not configured in environment.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/email/routing/addresses`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
      },
    });

    const cfData = await cfRes.json();

    if (!cfData.success) {
      return new Response(JSON.stringify({ error: 'Failed to fetch destination addresses' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const addresses = (cfData.result || []).map(item => ({
      email: item.email,
      verified: item.status === 'verified' || !!item.verified,
      created: item.created,
      status: item.status,
    }));

    return new Response(JSON.stringify({
      success: true,
      destinations: addresses,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
