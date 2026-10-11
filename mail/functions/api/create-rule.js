/**
 * Cloudflare Pages Function: /api/create-rule
 * Creates a dedicated forwarding rule from student alias to verified destination email
 */
export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const data = await context.request.json();
    let alias = (data.alias || '').trim().toLowerCase();
    const destination = (data.destination || '').trim().toLowerCase();

    if (!alias || !destination) {
      return new Response(JSON.stringify({ error: 'Alias and destination email are required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!alias.endsWith('@khanpro.me')) {
      alias = `${alias}@khanpro.me`;
    }

    const ZONE_ID = context.env.CF_ZONE_ID;
    const API_TOKEN = context.env.CF_API_TOKEN;

    if (!API_TOKEN || !ZONE_ID) {
      return new Response(JSON.stringify({ error: 'Cloudflare credentials not configured in environment.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cfRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/rules`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Direct Rule: ${alias}`,
        matchers: [
          {
            type: 'literal',
            field: 'to',
            value: alias,
          }
        ],
        actions: [
          {
            type: 'forward',
            value: [destination],
          }
        ],
        enabled: true,
        priority: 1,
      }),
    });

    const cfData = await cfRes.json();

    if (!cfData.success) {
      const errorMsg = cfData.errors && cfData.errors[0] ? cfData.errors[0].message : 'Failed to create rule';
      return new Response(JSON.stringify({ error: errorMsg, details: cfData.errors }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      alias,
      destination,
      ruleId: cfData.result.id,
      message: `Direct forward rule active: ${alias} -> ${destination}`
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
