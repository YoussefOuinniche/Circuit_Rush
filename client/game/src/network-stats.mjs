// Application-level measurements; these are messages, not IP packets or TCP segments.
const bucket = () => ({ duration: 0, attempted: 0, sent: 0, dropped: 0, bytes: 0,
  acknowledged: 0, rttSum: 0, rttMax: 0, jitterSum: 0, previousRtt: null,
  received: 0, stale: 0 });

export class NetworkStats {
  constructor(now = () => performance.now()) { this.now = now; this.reset(); }
  reset() {
    this.protocol = 'udp'; this.active = false; this.started = false;
    this.data = { tcp: bucket(), udp: bucket() }; this.pending = new Map();
  }
  start() { if (!this.started) { this.started = this.active = true; this.since = this.now(); } }
  switch(protocol) {
    if (!['tcp', 'udp'].includes(protocol) || protocol === this.protocol) return;
    this.accrue(); this.protocol = protocol;
  }
  accrue() {
    if (!this.active) return;
    const now = this.now(); this.data[this.protocol].duration += now - this.since; this.since = now;
  }
  stop() { this.accrue(); this.active = false; }
  sent(seq, bytes, dropped) {
    if (!this.active) return;
    const b = this.data[this.protocol]; b.attempted++;
    if (dropped) { b.dropped++; return; }
    b.sent++; b.bytes += bytes;
    this.pending.set(seq, { protocol: this.protocol, at: this.now() });
  }
  acknowledge(seq, protocol) {
    const p = this.pending.get(seq);
    if (!p || p.protocol !== protocol) return;
    this.pending.delete(seq);
    const b = this.data[protocol], rtt = Math.max(0, this.now() - p.at);
    b.acknowledged++; b.rttSum += rtt; b.rttMax = Math.max(b.rttMax, rtt);
    if (b.previousRtt !== null) b.jitterSum += Math.abs(rtt - b.previousRtt);
    b.previousRtt = rtt;
  }
  receive(protocol, stale) {
    if (!this.active || !this.data[protocol]) return;
    this.data[protocol].received++;
    if (stale) this.data[protocol].stale++;
  }
  snapshot() {
    this.accrue();
    return Object.fromEntries(Object.entries(this.data).map(([p, b]) => [p, {
      ...b, seconds: b.duration / 1000,
      rtt: b.acknowledged ? b.rttSum / b.acknowledged : null,
      jitter: b.acknowledged > 1 ? b.jitterSum / (b.acknowledged - 1) : null,
      unacknowledged: b.sent - b.acknowledged,
      rate: b.duration ? b.sent / (b.duration / 1000) : null,
      kibPerSecond: b.duration ? b.bytes / 1024 / (b.duration / 1000) : null,
    }]));
  }
}
