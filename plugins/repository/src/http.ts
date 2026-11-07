import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";

/*
 * How isomorphic-git reaches a repository: through the app's network API, which only goes where the writer allowed. Requests
 * can be large in both directions, so this uses the streaming call, which allows up to 200 MB and ten minutes, and
 * not fetch, which stops at 20 MB and 30 seconds.
 */

export interface NetAccess {
  streamBytes(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } | undefined,
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<{ ok: boolean; status: number; statusText: string; headers: Record<string, string> }>;
}

const joined = (parts: Uint8Array[]) => {
  const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.length;
  }
  return whole;
};

/**
 * Adds a HEAD line to the list of refs that a server sends first, if the list has
 * none. Without one, isomorphic-git's fetch throws "Could not find HEAD" before it
 * saves what it fetched. That happens when HEAD names a branch that doesn't exist,
 * as in a repository of book branches with no "main". Given a HEAD, the fetch carries on.
 * Lines are git's pkt-lines: four hex digits of length, then the line.
 */
export function withHead(body: Uint8Array): Uint8Array {
  const text = new TextDecoder("latin1").decode(body);
  const lines: string[] = [];
  for (let at = 0; at < text.length; ) {
    const size = parseInt(text.slice(at, at + 4), 16);
    if (Number.isNaN(size)) return body;
    lines.push(size === 0 ? "" : text.slice(at + 4, at + size));
    at += size === 0 ? 4 : size;
  }
  // With protocol v2, which Forgejo uses when asked, the reply has capabilities instead of refs, so there's no HEAD to fix.
  if (lines.some((l) => l.trim() === "version 2")) return body;
  // The service line, a flush, then the refs. The first ref carries the capabilities after a NUL.
  const first = lines.findIndex((l, i) => i > 0 && lines[i - 1] === "" && l !== "");
  if (first < 0 || !/^[0-9a-f]{40,64} \S/.test(lines[first])) return body;
  const refs = lines.slice(first).filter(Boolean);
  if (refs.some((l) => l.split("\0")[0].trim().endsWith(" HEAD"))) return body;
  const [refPart, caps = ""] = lines[first].split("\0");
  const oid = refPart.split(" ")[0];
  if (/^0+$/.test(oid)) return body;
  lines.splice(first, 1, `${oid} HEAD\0${caps}`, `${refPart}${refPart.endsWith("\n") ? "" : "\n"}`);
  const pkt = (l: string) => (l === "" ? "0000" : (l.length + 4).toString(16).padStart(4, "0") + l);
  return Uint8Array.from(lines.map(pkt).join(""), (c) => c.charCodeAt(0));
}

/** Builds the client. App requests don't follow redirects, so an address without ".git" that the server redirects is tried once with it, as git does. */
export function netClient(net: NetAccess): HttpClient {
  let moved: { from: string; to: string } | null = null;
  return {
    async request(req: GitHttpRequest): Promise<GitHttpResponse> {
      const { url, method = "GET", headers = {}, body } = req;
      const parts: Uint8Array[] = [];
      if (body) for await (const part of body) parts.push(part);
      const sent = parts.length ? joined(parts) : undefined;
      const send = async (to: string) => {
        const received: Uint8Array[] = [];
        const res = await net.streamBytes(to, { method, headers, ...(sent ? { body: sent } : {}) }, (chunk) => void received.push(chunk));
        return { res, whole: joined(received) };
      };
      const go = moved && url.startsWith(moved.from) ? moved.to + url.slice(moved.from.length) : url;
      let answer;
      try {
        answer = await send(go);
      } catch (err) {
        const refs = /^(.*?)\/info\/refs(\?.*)?$/.exec(go);
        if (!refs || refs[1].endsWith(".git") || !/redirect/i.test((err as Error).message)) throw err;
        moved = { from: refs[1], to: `${refs[1]}.git` };
        answer = await send(`${moved.to}${go.slice(refs[1].length)}`);
      }
      const { res, whole } = answer;
      const lower = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const mended = /\/info\/refs\?service=git-upload-pack$/.test(url) && res.status === 200 ? withHead(whole) : whole;
      return {
        url,
        method,
        statusCode: res.status,
        statusMessage: res.statusText,
        headers: lower,
        body: (async function* () {
          yield mended;
        })(),
      };
    },
  };
}
