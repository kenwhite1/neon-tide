// Headless guest for verifying the relay + room protocol end-to-end.
//   node server/test-client.mjs <ROOMCODE>
import WebSocket from 'ws';

const room = process.argv[2];
if (!room) {
  console.error('usage: node server/test-client.mjs <ROOMCODE>');
  process.exit(1);
}

const ws = new WebSocket(process.env.RELAY_URL || 'ws://localhost:8791');
const stats = { xf: 0, ev: [], place: 0, remove: 0, joinedDesign: 0 };
let removedTotal = 0;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', room, create: false, name: 'Bot Bob' }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.t) {
    case 'joined':
      stats.joinedDesign = msg.design.length;
      console.log(`[joined] room=${msg.room} players=${msg.players.map((p) => p.name).join(',')} design=${msg.design.length} blocks`);
      // guest places a gold block on the shared plot
      ws.send(JSON.stringify({ t: 'place', b: { gx: 3, gy: 0, gz: 3, rot: 0, kind: 'gold', owner: 'bot-bob' } }));
      console.log('[sent] place gold @ 3,0,3');
      // and streams a little steering input during the run
      setInterval(() => ws.send(JSON.stringify({ t: 'input', s: 0.5, th: 0, j: 0 })), 500);
      break;
    case 'place':
      stats.place++;
      console.log(`[recv] place ${msg.b.kind} @ ${msg.b.gx},${msg.b.gy},${msg.b.gz} from ${msg.from}`);
      break;
    case 'remove':
      stats.remove++;
      break;
    case 'launch':
      console.log('[recv] LAUNCH from host');
      break;
    case 'xf':
      stats.xf++;
      removedTotal += (msg.data.removed ?? []).length;
      if (stats.xf === 1) console.log(`[recv] first xf packet main=[${msg.data.main.slice(0, 3).map((n) => n.toFixed(1))}]`);
      if (stats.xf % 50 === 0) console.log(`[recv] xf x${stats.xf} boatZ=${msg.data.main[2].toFixed(1)} removedSoFar=${removedTotal}`);
      break;
    case 'ev':
      stats.ev.push(msg.ev.k + (msg.ev.n ?? ''));
      console.log(`[recv] EVENT ${JSON.stringify(msg.ev)}`);
      break;
    case 'err':
      console.error('[err]', msg.msg);
      process.exit(1);
  }
});

ws.on('close', () => {
  console.log(`[done] xf=${stats.xf} events=${stats.ev.join('|')} placeEchoes=${stats.place} removedBlocks=${removedTotal}`);
  process.exit(0);
});

setTimeout(() => {
  console.log(`[summary] xf=${stats.xf} events=${stats.ev.join('|')} removedBlocks=${removedTotal}`);
  ws.close();
}, 55000);
