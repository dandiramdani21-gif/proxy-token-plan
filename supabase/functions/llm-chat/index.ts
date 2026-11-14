// Transparent proxy for Alibaba Token Plan's Anthropic-compatible API.
// Clients keep their own API key, model and request body; only the base URL changes:
//   ANTHROPIC_BASE_URL=https://<project-ref>.supabase.co/functions/v1/llm-chat
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const UPSTREAM = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic";

// Hop-by-hop and gateway headers are not forwarded; accept-encoding is dropped so fetch()
// negotiates compression itself and hands back a decoded body.
const DROP_REQUEST = /^(host|connection|keep-alive|content-length|transfer-encoding|te|upgrade|accept-encoding|apikey|x-client-info|forwarded|x-real-ip|x-forwarded-.*|cf-.*|sb-.*)$/;
const DROP_RESPONSE = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive)$/;

export default {
  // auth "none": the caller's own API key is the credential and upstream validates it.
  fetch: withSupabase({
    auth: "none",
    cors: { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, *", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } },
  }, async (req) => {
    const url = new URL(req.url);
    // /functions/v1/llm-chat/v1/messages?beta=true -> <UPSTREAM>/v1/messages?beta=true
    const target = UPSTREAM + url.pathname.replace(/^.*?\/llm-chat/, "") + url.search;

    const headers = new Headers();
    for (const [name, value] of req.headers) if (!DROP_REQUEST.test(name)) headers.set(name, value);

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        signal: req.signal, // client disconnect cancels the upstream call
      });
      const out = new Headers();
      for (const [name, value] of upstream.headers) if (!DROP_RESPONSE.test(name)) out.set(name, value);
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ type: "error", error: { type: "api_error", message: `Upstream unreachable: ${message}` } }, { status: 502 });
    }
  }),
};
