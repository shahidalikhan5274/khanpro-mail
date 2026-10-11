/**
 * Cloudflare Pages Function: /api/send-verification
 * Sends Cloudflare official verification email to destination address
 */
export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const data = await context.request.json();
    const email = (data.email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email address is required.' }), {
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
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const cfData = await cfRes.json();

    if (!cfData.success) {
      // Check if address already exists in list
      const errorMsg = cfData.errors && cfData.errors[0] ? cfData.errors[0].message : 'Cloudflare API error';
      if (errorMsg.toLowerCase().includes('already exists') || cfData.errors?.some(e => e.code === 2005)) {
        return new Response(JSON.stringify({
          success: true,
          alreadyExists: true,
          email,
          message: 'Destination address already registered in Cloudflare. Check inbox for verification link.'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: errorMsg, details: cfData.errors }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      email,
      status: cfData.result.status || 'unverified',
      message: 'Verification email sent successfully! Please check your Gmail.'
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
