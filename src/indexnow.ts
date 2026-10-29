/**
 * IndexNow submission (Bing, Yandex, Seznam, Naver and the other participating
 * engines; Google does not take part). The key is public by design: the
 * engines verify it by fetching `keyLocation` from the site itself.
 * Protocol: https://www.indexnow.org/documentation
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** The protocol's limit per request. */
export const INDEXNOW_MAX_URLS = 10000;

export interface IndexNowResult {
  submitted: number;
  batches: { size: number; status: number; statusText: string; body?: string }[];
  ok: boolean;
}

export async function submitIndexNow(params: {
  host: string;
  key: string;
  keyLocation?: string;
  urls: string[];
  endpoint?: string;
}): Promise<IndexNowResult> {
  const { host, key, urls } = params;
  const endpoint = params.endpoint ?? INDEXNOW_ENDPOINT;
  const keyLocation = params.keyLocation ?? `https://${host}/${key}.txt`;

  const offHost = urls.filter((u) => {
    try {
      return new URL(u).hostname !== host;
    } catch {
      return true;
    }
  });
  if (offHost.length > 0) {
    throw new Error(
      `Every URL must be on ${host}; ${offHost.length} are not (first: ${offHost[0]}). IndexNow rejects mixed-host batches.`,
    );
  }

  const batches: IndexNowResult['batches'] = [];
  for (let i = 0; i < urls.length; i += INDEXNOW_MAX_URLS) {
    const batch = urls.slice(i, i + INDEXNOW_MAX_URLS);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
    });
    // 200 = submitted, 202 = accepted while the key is being validated.
    const ok = res.status === 200 || res.status === 202;
    batches.push({
      size: batch.length,
      status: res.status,
      statusText: res.statusText,
      ...(ok ? {} : { body: (await res.text()).slice(0, 500) }),
    });
  }

  return {
    submitted: urls.length,
    batches,
    ok: batches.every((b) => b.status === 200 || b.status === 202),
  };
}
