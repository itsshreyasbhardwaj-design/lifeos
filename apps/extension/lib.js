// Shared by the popup and the background worker. No analytics, no remote code.
export async function settings() {
  const s = await chrome.storage.local.get(['server', 'token']);
  return { server: (s.server || '').replace(/\/+$/, ''), token: s.token || '' };
}

export async function saveSettings(server, token) {
  // No host permissions: the LifeOS server answers CORS for extension origins
  // on token-authenticated requests, so the extension cannot read any site.
  const origin = new URL(server).origin;
  await chrome.storage.local.set({ server: origin, token: token.trim() });
}

const clientId = () => `ext${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

async function call(path, body) {
  const { server, token } = await settings();
  if (!server || !token) throw new Error('Connect LifeOS first (server address and token).');
  const res = await fetch(`${server}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `LifeOS answered ${res.status}`);
  return json.data;
}

export const captureItem = (item) => call('/captures', { ...item, sourceType: 'extension', sourceApp: 'browser-extension', clientId: clientId() });
export const quickTask = (text) => call('/tasks', { quick: text });
