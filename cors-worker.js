/**
 * CTA API CORS Proxy — Cloudflare Worker
 *
 * Deploys a lightweight proxy that only forwards requests to CTA API domains,
 * solving the CORS issue for custom domains (e.g. timbargo.com) that are
 * blocked by public free-tier CORS proxies.
 *
 * HOW TO DEPLOY:
 *   1. Sign up at https://dash.cloudflare.com (free account)
 *   2. Go to Workers & Pages → Create application → Create Worker
 *   3. Paste this entire file into the editor and click "Deploy"
 *   4. Copy the assigned *.workers.dev URL (e.g. https://cta-cors.your-handle.workers.dev)
 *   5. In the CTA Tracker Settings → paste that URL into "Custom Proxy URL"
 *
 * OPTIONAL — bind to your own subdomain:
 *   In the Worker settings add a Custom Domain like: proxy.timbargo.com
 *
 * Free tier: 100,000 requests/day, no credit card required.
 */

// Only these CTA API hostnames are allowed through the proxy.
const ALLOWED_HOSTS = [
  'ctabustracker.com',
  'lapi.transitchicago.com',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const incoming = new URL(request.url);
    const targetParam = incoming.searchParams.get('url');

    if (!targetParam) {
      return new Response(
        JSON.stringify({ error: 'Missing required ?url= parameter' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetParam);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid url parameter' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Security: only proxy to known CTA API domains
    const isAllowed = ALLOWED_HOSTS.some(host => targetUrl.hostname === host || targetUrl.hostname.endsWith('.' + host));
    if (!isAllowed) {
      return new Response(
        JSON.stringify({ error: 'Target host not permitted' }),
        { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Forward the request to CTA
    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'CTA-Tracker-Proxy/1.0' },
        cf: { cacheEverything: false },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Upstream fetch failed', detail: err.message }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('Content-Type') || 'application/json';

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType,
      },
    });
  },
};
