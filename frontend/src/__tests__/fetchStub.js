import { vi } from "vitest";

/** fetch stub routed by URL substring. Each handler returns { status, body } or a Response. */
export function stubFetch(routes) {
  const fetchMock = vi.fn(async (url, init) => {
    for (const [match, handler] of Object.entries(routes)) {
      if (String(url).includes(match)) {
        const out = await handler(url, init);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out.body ?? {}), {
          status: out.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const NETWORK = {
  name: "Example Testnet",
  isTestnet: true,
  chainId: 1234,
  explorerUrl: "https://explorer.example",
  contractAddress: "0x2c6008c33958949E69019797E39C572BB84f6589",
};
