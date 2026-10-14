/** Shipped crypto + RPC client -> local Worker v2 -> Docker daemon -> real Herdr. */
import { strict as assert } from 'node:assert';
import { pairOverWS, sessionOverWS } from '../../pwa/src/lib/protocol/client.ts';

const offer = JSON.parse(await Bun.file(process.env.PAIRFOB_TEST_OFFER!).text());
const relay = process.env.PAIRFOB_TEST_RELAY || 'ws://127.0.0.1:18786/v2/ws?role=client';
const pairURL = new URL(offer.pair_url);
const daemonID = new URLSearchParams(pairURL.hash.slice(1)).get('d') || pairURL.searchParams.get('daemon_id');
const ws = new URL(relay);
if (daemonID) ws.searchParams.set('daemon_id', daemonID);
const NativeWebSocket = globalThis.WebSocket;
// Bun has no browser origin; supply the same Origin header a browser sends.
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, { protocols, headers: { Origin: new URL(relay.replace(/^ws/, 'http')).origin } });
  }
} as typeof WebSocket;
const pair = await pairOverWS(ws.toString(), { pair_ref: offer.pair_ref }, offer.code, { label: 'Docker onboarding test' });
console.log('PASS: v2 pairing and operator approval');
let session = await sessionOverWS(ws.toString(), pair);
try {
  const config = await session.getConfig();
  assert.equal((config.capabilities as Record<string, boolean>).create_conversation, true);
  const created = await session.createConversation({ cwd: '/tmp/pairfob-live-home', label: 'docker-live-chain' });
  assert.equal(created.outcome, 'applied');
  await session.sendText(created.pane_id, "printf 'PAIRFOB_CHAIN_%s\\n' 'OK'");
  await session.sendKeys(created.pane_id, ['Enter']);
  let text = '';
  for (let i = 0; i < 50; i++) {
    text = (await session.paneRead(created.pane_id, 100, 'text')).text;
    if (text.includes('PAIRFOB_CHAIN_OK')) break;
    await Bun.sleep(100);
  }
  assert.ok(text.includes('PAIRFOB_CHAIN_OK'), text);
  console.log('PASS: capabilities, create terminal, send input and read real PTY output');
  await assert.rejects(session.createConversation({ cwd: '/outside-allowed-root' }));
  await assert.rejects(session.createConversation({ cwd: '/tmp/pairfob-live-home/does-not-exist' }));
  // Herdr acknowledges dispatch before the shell discovers a missing CLI.
  // Keep that real pane/output visible; do not invent a successful login or
  // silently fall back to a different agent.
  const missing = await session.createConversation({ cwd: '/tmp/pairfob-live-home', agent_kind: 'codex', label: 'missing-agent' });
  let failure = '';
  for (let i = 0; i < 50; i++) {
    failure = (await session.paneRead(missing.pane_id, 100, 'text')).text;
    if (/codex/.test(failure) && /not found|No such file/.test(failure)) break;
    await Bun.sleep(100);
  }
  assert.match(failure, /codex/);
  assert.match(failure, /not found|No such file/);
  await session.closePane(missing.pane_id);
  console.log('PASS: absent agent CLI exposes actual command-not-found output in its pane');
  session.close();
  session = await sessionOverWS(ws.toString(), pair);
  assert.ok((await session.paneRead(created.pane_id, 100, 'text')).text.includes('PAIRFOB_CHAIN_OK'));
  await session.snapshot();
  await session.closePane(created.pane_id);
  console.log('PASS: invalid paths fail closed, encrypted reconnect retains pane, explicit close');
} finally {
  session.close();
}
