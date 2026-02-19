const ALLOWED_HOSTS = ['ctabustracker.com', 'lapi.transitchicago.com'];
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request } = context;
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

  const isAllowed = ALLOWED_HOSTS.some(
    host => targetUrl.hostname === host || targetUrl.hostname.endsWith('.' + host)
  );
  if (!isAllowed) {
    return new Response(
      JSON.stringify({ error: 'Target host not permitted' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      headers: { 'User-Agent': 'CTA-Tracker-Proxy/1.0' },
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
    headers: { ...CORS_HEADERS, 'Content-Type': contentType },
  });
}
