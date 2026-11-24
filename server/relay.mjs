import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const rooms = new Map();
const clients = new Map();

function frameText(str) {
  const data = Buffer.from(str, 'utf8');
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}

function broadcast(room, sender, payload) {
  const set = rooms.get(room);
  if (!set) return;
  const buf = frameText(typeof payload === 'string' ? payload : JSON.stringify(payload));
  for (const sock of set) if (sock !== sender && !sock.destroyed) sock.write(buf);
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Wings of Steel WebSocket Relay\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  let buf = Buffer.alloc(0);
  clients.set(socket, { room: null, id: null });

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      if (opcode === 8) { socket.end(); return; }
      const mask = masked ? buf.subarray(off, off + 4) : null;
      const raw = Buffer.from(buf.subarray(off + (masked ? 4 : 0), total));
      if (mask) for (let i = 0; i < raw.length; i++) raw[i] ^= mask[i & 3];
      buf = buf.subarray(total);
      if (opcode !== 1) continue;
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { continue; }
      const meta = clients.get(socket);
      if (msg.type === 'join' && msg.room) {
        if (meta.room) rooms.get(meta.room)?.delete(socket);
        meta.room = String(msg.room).slice(0, 24);
        meta.id = msg.id;
        if (!rooms.has(meta.room)) rooms.set(meta.room, new Set());
        rooms.get(meta.room).add(socket);
        broadcast(meta.room, socket, msg);
      } else if (meta.room) {
        broadcast(meta.room, socket, msg);
      }
    }
  });

  socket.on('close', () => {
    const meta = clients.get(socket);
    if (meta?.room) {
      rooms.get(meta.room)?.delete(socket);
      broadcast(meta.room, socket, { type: 'leave', id: meta.id });
    }
    clients.delete(socket);
  });
});

server.listen(PORT, () => console.log(`Wings of Steel relay listening on ws://localhost:${PORT}`));
