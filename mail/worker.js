/**
 * ===================================================================
 * CLOUDFLARE EMAIL WORKER - KHANPRO.ME PRODUCTION ROUTER
 * ===================================================================
 * 
 * How to deploy on Cloudflare:
 * 1. Go to Cloudflare Dashboard -> Workers & Pages -> Create Worker.
 * 2. Paste this code into the Worker editor.
 * 3. Bind a KV Namespace named "STUDENTS_KV" to this worker.
 * 4. Go to Email Routing -> Routing Rules -> Catch-All -> Action: Send to Worker.
 */

export default {
  // 1. Inbound Email Router
  async email(message, env, ctx) {
    try {
      // Extract prefix from recipient (e.g. 'bsf1900166' from 'bsf1900166@khanpro.me')
      const toAddress = message.to.toLowerCase();
      const recipientPrefix = toAddress.split('@')[0];

      console.log(`[INBOUND] Received email for: ${toAddress} from: ${message.from}`);

      // Lookup student's destination Gmail from Cloudflare KV
      let destinationGmail = null;
      if (env.STUDENTS_KV) {
        destinationGmail = await env.STUDENTS_KV.get(recipientPrefix);
      }

      // Fallback destination if student is not registered or KV is empty
      if (!destinationGmail) {
        destinationGmail = env.FALLBACK_GMAIL || "hasilvasay@gmail.com";
        console.log(`[FALLBACK] Prefix '${recipientPrefix}' not in KV, using fallback: ${destinationGmail}`);
      }

      // Forward email natively to the verified Gmail cluster
      await message.forward(destinationGmail);
      console.log(`[SUCCESS] Forwarded to verified destination: ${destinationGmail}`);

    } catch (error) {
      console.error(`[ERROR] Failed to route email: ${error.message}`);
      // Do not reject so sending server doesn't bounce immediately
    }
  },

  // 2. HTTP Handler (Optional API for Cloudflare KV sync)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'healthy', domain: 'khanpro.me' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // API: Activate student alias
    if (url.pathname === '/api/activate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { prefix, gmail } = body;

        if (!prefix || !gmail) {
          return new Response(JSON.stringify({ error: 'Missing prefix or gmail' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const cleanPrefix = prefix.toLowerCase().trim();
        const cleanGmail = gmail.toLowerCase().trim();

        if (env.STUDENTS_KV) {
          await env.STUDENTS_KV.put(cleanPrefix, cleanGmail);
        }

        return new Response(JSON.stringify({ success: true, email: `${cleanPrefix}@khanpro.me`, destination: cleanGmail }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response("KhanPro.me Cloudflare Edge Email Engine is Active.", {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }
};
