/**
 * Cloudflare Pages Function: /api/check-status
 * Checks if a destination email address is verified
 */
export async function onRequestGet(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const url = new URL(context.request.url);
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email query param' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
      return new Response(JSON.stringify({ error: 'Failed to query Cloudflare destination addresses' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const matched = cfData.result.find(item => item.email.toLowerCase() === email);

    if (!matched) {
      return new Response(JSON.stringify({
        found: false,
        verified: false,
        status: 'not_found',
        message: 'Destination address not found in Cloudflare routing list.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isVerified = matched.status === 'verified' || !!matched.verified;

    return new Response(JSON.stringify({
      found: true,
      email: matched.email,
      verified: isVerified,
      status: isVerified ? 'verified' : 'unverified',
      verifiedAt: matched.verified,
    }), {
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
