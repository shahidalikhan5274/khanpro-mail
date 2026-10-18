/**
 * ===================================================================
 * KHANPRO.ME - FULL MULTI-USER D1 WEBMAIL BACKEND ENGINE
 * ===================================================================
 * 
 * Features:
 * 1. Email Handler: Receives any inbound email for *@khanpro.me
 *    Parses sender, subject, body text, body html, and OTP codes.
 *    Saves into Cloudflare D1 SQL database.
 * 2. Auth API: Register with unique username & password, Login.
 * 3. Inbox API: Isolated user mailbox, view email, delete email.
 * 4. Admin API: Master Admin overview & stats.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Email, X-User-Token',
};

// SHA-256 password hash helper
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "_khanpro_salt_5274");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple base64 auth token generator/validator
function createToken(email, passwordHash) {
  const payload = `${email}:${passwordHash}:${Date.now()}`;
  return btoa(payload);
}

function parseToken(token) {
  try {
    const raw = atob(token);
    const parts = raw.split(':');
    return { email: parts[0], passwordHash: parts[1] };
  } catch (e) {
    return null;
  }
}

// Helper to authenticate request
async function authenticateUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  let token = authHeader.replace(/^Bearer\s+/i, '').trim();
  
  if (!token) {
    const url = new URL(request.url);
    token = url.searchParams.get('token');
  }

  if (!token) return null;

  const creds = parseToken(token);
  if (!creds || !creds.email || !creds.passwordHash) return null;

  const user = await env.DB.prepare(
    "SELECT id, name, email FROM users WHERE email = ? AND password_hash = ?"
  ).bind(creds.email.toLowerCase(), creds.passwordHash).first();

  return user || null;
}

// OTP Extractor
function extractOtp(subject, body) {
  const text = `${subject || ''} \n ${body || ''}`;
  
  // Specific patterns first: "code is 123456", "OTP: 482910", "Verification code: 8291"
  const specificMatch = text.match(/(?:verification\s*code|security\s*code|otp|pin|passcode)[\s:=-]+([0-9]{4,8})/i);
  if (specificMatch && specificMatch[1]) {
    return specificMatch[1];
  }

  // Fallback: any standalone 4-8 digit number
  const generalMatch = text.match(/\b([0-9]{4,8})\b/);
  if (generalMatch && generalMatch[1]) {
    return generalMatch[1];
  }

  return null;
}

// Lightweight MIME Body Parser
function parseMimeBody(rawMime) {
  let bodyText = "";
  let bodyHtml = "";

  try {
    // Check if multipart
    const contentTypeMatch = rawMime.match(/Content-Type:\s*multipart\/[a-zA-Z]+;\s*boundary="?([^"\r\n;]+)"?/i);
    
    if (contentTypeMatch && contentTypeMatch[1]) {
      const boundary = contentTypeMatch[1];
      const parts = rawMime.split(`--${boundary}`);
      
      for (const part of parts) {
        if (part.includes('Content-Type: text/plain')) {
          const bodySection = part.split(/\r?\n\r?\n/)[1] || '';
          bodyText += cleanBodyContent(bodySection, part);
        } else if (part.includes('Content-Type: text/html')) {
          const bodySection = part.split(/\r?\n\r?\n/)[1] || '';
          bodyHtml += cleanBodyContent(bodySection, part);
        }
      }
    } else {
      // Single part email
      const parts = rawMime.split(/\r?\n\r?\n/);
      if (parts.length > 1) {
        const headers = parts[0];
        const rawBody = parts.slice(1).join('\n\n');
        if (headers.includes('Content-Type: text/html')) {
          bodyHtml = cleanBodyContent(rawBody, headers);
        } else {
          bodyText = cleanBodyContent(rawBody, headers);
        }
      } else {
        bodyText = rawMime;
      }
    }
  } catch (err) {
    bodyText = rawMime.slice(0, 5000);
  }

  if (!bodyText && bodyHtml) {
    // Strip HTML tags for text preview
    bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return {
    text: (bodyText || '').trim(),
    html: (bodyHtml || '').trim()
  };
}

function cleanBodyContent(content, headers) {
  let res = content;
  if (headers.includes('Content-Transfer-Encoding: base64')) {
    try {
      res = atob(content.replace(/\s+/g, ''));
    } catch (e) {}
  } else if (headers.includes('Content-Transfer-Encoding: quoted-printable')) {
    res = content.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
  return res;
}

export default {
  // =================================================================
  // 1. INBOUND EMAIL WORKER (CLOUDFLARE EMAIL ROUTING CATCH-ALL)
  // =================================================================
  async email(message, env, ctx) {
    try {
      const recipient = (message.to || '').toLowerCase().trim();
      const sender = (message.from || '').trim();
      const subject = message.headers.get('subject') || '(No Subject)';
      
      console.log(`[MAIL RECEIVE] Inbound email for: ${recipient} from: ${sender}`);

      // Read raw email body
      let rawText = '';
      try {
        const rawStream = new Response(message.raw);
        rawText = await rawStream.text();
      } catch (err) {
        console.warn('[MAIL RECEIVE] Could not read raw stream:', err);
      }

      // Parse text & html
      const parsed = parseMimeBody(rawText);
      const bodyText = parsed.text || '(Empty Body)';
      const bodyHtml = parsed.html || '';

      // Extract OTP code
      const otpCode = extractOtp(subject, bodyText);

      // Save into Cloudflare D1
      await env.DB.prepare(
        `INSERT INTO emails (recipient, sender, subject, body_text, body_html, otp_code) 
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        recipient,
        sender,
        subject,
        bodyText.slice(0, 50000), // Max 50KB text
        bodyHtml.slice(0, 100000), // Max 100KB html
        otpCode || null
      ).run();

      console.log(`[SUCCESS] Stored email for ${recipient}. OTP: ${otpCode || 'None'}`);

    } catch (error) {
      console.error(`[ERROR] Inbound email processing failed: ${error.message}`);
    }
  },

  // =================================================================
  // 2. HTTP REST API FOR WEB CLIENT
  // =================================================================
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'KhanPro Multi-User Mailbox Engine',
        domain: 'khanpro.me',
        version: '2.0.0'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // -------------------------------------------------------------
    // POST /api/auth/register
    // -------------------------------------------------------------
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      try {
        const body = await request.json();
        const name = (body.name || '').trim();
        let username = (body.username || '').toLowerCase().trim();
        const password = body.password || '';
        const inviteKey = (body.inviteKey || '').trim();

        // Enforce Passkey Protection
        if (inviteKey !== 'Rafay5@74' && inviteKey !== 'Shahid5@74') {
          return new Response(JSON.stringify({
            error: 'Ghalat Access Key! Naya mailbox sirf wahi create kar sakte hain jin ke paas authorized Student Passkey (Rafay5@74) ho.'
          }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Validation
        if (!name || name.length < 2) {
          return new Response(JSON.stringify({ error: 'Apna mukammal naam likhein (kam az kam 2 characters).' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Clean username: remove '@khanpro.me' if user wrote it
        username = username.replace(/@.*$/, '').replace(/[^a-z0-9._-]/g, '');
        if (!username || username.length < 3) {
          return new Response(JSON.stringify({ error: 'Username kam az kam 3 characters ka hona chahiye (letters, numbers, dots).' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!password || password.length < 6) {
          return new Response(JSON.stringify({ error: 'Password kam az kam 6 characters ka hona chahiye.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const email = `${username}@khanpro.me`;

        // Check if user already exists
        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (existing) {
          return new Response(JSON.stringify({ 
            error: `Yeh address '${email}' pehle se kisi ne le liya hai! Koi doosra username chunein.` 
          }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const passwordHash = await hashPassword(password);

        // Insert user
        const result = await env.DB.prepare(
          "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"
        ).bind(name, email, passwordHash).run();

        // Insert Welcome Email into user's new inbox
        const welcomeSubject = "🎉 Welcome to your Private KhanPro Mailbox!";
        const welcomeBody = `Assalam-o-Alaikum ${name}!

Aapka private @khanpro.me email mailbox kamyabi se active ho chuka hai!

Email Address: ${email}
Status: 100% Active & Ready to Receive Emails

Aap is email address ko kisi bhi website, app ya verification service par use kar sakte hain (Canva, OpenAI, Google, Netflix, Student discounts, etc.).

Jab bhi koi service aapke is email par OTP ya verification code bhejegi, woh foran yahan aapke inbox mein show ho jayegi!

Shukriya,
Team KhanPro`;

        await env.DB.prepare(
          `INSERT INTO emails (recipient, sender, subject, body_text, otp_code) 
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          email,
          'support@khanpro.me',
          welcomeSubject,
          welcomeBody,
          '7452'
        ).run();

        const token = createToken(email, passwordHash);

        return new Response(JSON.stringify({
          success: true,
          message: 'Account kamyabi se create ho gaya!',
          user: {
            id: result.meta?.last_row_id || 1,
            name,
            email
          },
          token
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Registration failed: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // -------------------------------------------------------------
    // POST /api/auth/login
    // -------------------------------------------------------------
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        let inputEmail = (body.email || '').toLowerCase().trim();
        const password = body.password || '';

        if (!inputEmail || !password) {
          return new Response(JSON.stringify({ error: 'Email aur Password dono likhna lazmi hain.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!inputEmail.includes('@')) {
          inputEmail = `${inputEmail}@khanpro.me`;
        }

        const passwordHash = await hashPassword(password);

        const user = await env.DB.prepare(
          "SELECT id, name, email FROM users WHERE email = ? AND password_hash = ?"
        ).bind(inputEmail, passwordHash).first();

        if (!user) {
          return new Response(JSON.stringify({ error: 'Email ya Password durust nahi hai. Dobara check karein.' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const token = createToken(user.email, passwordHash);

        return new Response(JSON.stringify({
          success: true,
          message: 'Login kamyab!',
          user: {
            id: user.id,
            name: user.name,
            email: user.email
          },
          token
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Login error: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // -------------------------------------------------------------
    // GET /api/inbox - Fetch Authenticated User's Mailbox
    // -------------------------------------------------------------
    if (url.pathname === '/api/inbox' && request.method === 'GET') {
      try {
        const user = await authenticateUser(request, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Pehle login karein.' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Fetch user's emails
        const { results } = await env.DB.prepare(
          `SELECT id, recipient, sender, subject, otp_code, is_read, received_at,
                  substr(body_text, 1, 140) as preview
           FROM emails 
           WHERE recipient = ? 
           ORDER BY received_at DESC 
           LIMIT 50`
        ).bind(user.email.toLowerCase()).all();

        return new Response(JSON.stringify({
          success: true,
          user: { name: user.name, email: user.email },
          emails: results || []
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to fetch inbox: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // -------------------------------------------------------------
    // GET /api/inbox/message - View Full Email
    // -------------------------------------------------------------
    if (url.pathname === '/api/inbox/message' && request.method === 'GET') {
      try {
        const user = await authenticateUser(request, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const id = url.searchParams.get('id');
        if (!id) {
          return new Response(JSON.stringify({ error: 'Missing email id' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const email = await env.DB.prepare(
          `SELECT id, recipient, sender, subject, body_text, body_html, otp_code, is_read, received_at
           FROM emails 
           WHERE id = ? AND recipient = ?`
        ).bind(id, user.email.toLowerCase()).first();

        if (!email) {
          return new Response(JSON.stringify({ error: 'Email nahi mila ya aapke paas access nahi hai.' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Mark as read
        await env.DB.prepare("UPDATE emails SET is_read = 1 WHERE id = ?").bind(id).run();

        return new Response(JSON.stringify({
          success: true,
          message: email
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to load email: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // -------------------------------------------------------------
    // POST /api/inbox/delete - Delete an email
    // -------------------------------------------------------------
    if (url.pathname === '/api/inbox/delete' && request.method === 'POST') {
      try {
        const user = await authenticateUser(request, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const body = await request.json();
        const id = body.id;

        await env.DB.prepare(
          "DELETE FROM emails WHERE id = ? AND recipient = ?"
        ).bind(id, user.email.toLowerCase()).run();

        return new Response(JSON.stringify({ success: true, message: 'Email deleted.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Failed to delete: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // -------------------------------------------------------------
    // POST /api/inbox/test-sim - Send Simulated Verification OTP
    // -------------------------------------------------------------
    if (url.pathname === '/api/inbox/test-sim' && request.method === 'POST') {
      try {
        const user = await authenticateUser(request, env);
        if (!user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const testOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const services = [
          { sender: 'Canva Security <security@canva.com>', service: 'Canva Pro' },
          { sender: 'Instagram Security <security@mail.instagram.com>', service: 'Instagram' },
          { sender: 'Discord Auth <noreply@discord.com>', service: 'Discord' },
          { sender: 'OpenAI Platform <noreply@tm.openai.com>', service: 'OpenAI ChatGPT' },
          { sender: 'GitHub <noreply@github.com>', service: 'GitHub' }
        ];
        const s = services[Math.floor(Math.random() * services.length)];

        const simSubject = `Your ${s.service} Security Verification Code: ${testOtp}`;
        const simBody = `Hello ${user.name},\n\nSomeone requested a verification code for your account on ${s.service}.\n\nYour One-Time Password (OTP) is: ${testOtp}\n\nThis verification code is valid for 10 minutes. If you did not request this, please ignore this email.\n\nThank you,\n${s.service} Security Team`;

        await env.DB.prepare(
          `INSERT INTO emails (recipient, sender, subject, body_text, otp_code) 
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          user.email.toLowerCase(),
          s.sender,
          simSubject,
          simBody,
          testOtp
        ).run();

        return new Response(JSON.stringify({
          success: true,
          message: 'Test OTP sent!',
          service: s.service,
          otp: testOtp
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Sim failed: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // -------------------------------------------------------------
    // GET /api/admin/stats - Master Admin Overview
    // -------------------------------------------------------------
    if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
      try {
        const adminKey = request.headers.get('X-Admin-Key') || url.searchParams.get('adminKey');
        if (adminKey !== 'Shahid5@74') {
          return new Response(JSON.stringify({ error: 'Admin access denied.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const userCount = await env.DB.prepare("SELECT count(*) as total FROM users").first();
        const emailCount = await env.DB.prepare("SELECT count(*) as total FROM emails").first();
        const { results: recentUsers } = await env.DB.prepare(
          "SELECT id, name, email, created_at FROM users ORDER BY created_at DESC LIMIT 15"
        ).all();

        return new Response(JSON.stringify({
          success: true,
          stats: {
            totalUsers: userCount?.total || 0,
            totalEmails: emailCount?.total || 0,
            recentUsers: recentUsers || []
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: 'Admin stats error: ' + err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response("KhanPro Multi-User Mailbox API Engine Active", {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }
};
