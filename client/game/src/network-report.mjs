const number = (n, unit = '') => n == null ? '\u2014' : `${n.toFixed(1)}${unit}`;
const percent = (part, total) => total > 0 ? number(100 * part / total, '%') : '\u2014';

export function networkReport(stats) {
  if (!stats) return '';
  const cell = (b, fn) => b.seconds > 0 ? fn(b) : '\u2014';
  const row = (label, fn) => `<tr><th scope="row">${label}</th>${['tcp', 'udp'].map((p) => `<td>${cell(stats[p], fn)}</td>`).join('')}</tr>`;
  const totalSeconds = stats.tcp.seconds + stats.udp.seconds;
  const totalSent = stats.tcp.sent + stats.udp.sent;
  const headings = `<thead><tr><th scope="col">Measurement</th><th scope="col">TCP${stats.tcp.seconds ? '' : '<small>Not sampled</small>'}</th><th scope="col">UDP${stats.udp.seconds ? '' : '<small>Not sampled</small>'}</th></tr></thead>`;
  let takeaway = 'Use both protocols during a race to compare their response times.';
  if (stats.tcp.rtt != null && stats.udp.rtt != null) {
    const difference = Math.abs(stats.tcp.rtt - stats.udp.rtt);
    takeaway = difference < 0.05 ? 'Both protocols had the same average response time to the displayed precision.'
      : `${stats.tcp.rtt < stats.udp.rtt ? 'TCP' : 'UDP'} had a ${number(difference, ' ms')} lower average response time in this race.`;
    takeaway += ' These measurements come from different portions of the race.';
  } else if (stats.tcp.seconds > 0 && stats.udp.seconds > 0) {
    takeaway = 'Not enough server replies to compare response times for both protocols.';
  }
  return `<section class="network-report" aria-labelledby="network-report-title">
    <div class="network-report-heading"><span class="network-eyebrow">YOUR RACE / NETWORK LAB</span>
      <h2 id="network-report-title">TCP vs UDP</h2></div>
    <p class="network-path">Browser bridge: WebSocket/TCP to the gateway; TCP/UDP comparison only on the gateway-to-server connection.</p>
    <table class="network-table network-summary"><caption>Your race at a glance</caption>
      ${headings}<tbody>
        ${row('Share of race time', (b) => percent(b.seconds, totalSeconds))}
        ${row('Share of sent updates', (b) => percent(b.sent, totalSent))}
        ${row('Sent updates confirmed<small>Server reply received</small>', (b) => percent(b.acknowledged, b.sent))}
        ${row('Average response time<small>Round trip \u00b7 lower is better</small>', (b) => number(b.rtt, ' ms'))}
      </tbody></table>
    <p class="network-takeaway">${takeaway}</p>
    ${(stats.tcp.dropped + stats.udp.dropped) > 0 ? `<p class="network-notes network-demo-note">Loss demo: ${stats.tcp.dropped + stats.udp.dropped} updates were deliberately skipped before sending. They are excluded from the confirmation percentage.</p>` : ''}
    <details class="network-details">
      <summary><span class="network-details-closed">See details</span><span class="network-details-open">Hide details</span></summary>
      <table class="network-table"><caption>All measurements from GO until your finish (or race end)</caption>
      ${headings}
      <tbody>
        ${row('Time selected', (b) => number(b.seconds, ' s'))}
        ${row('Updates attempted / sent', (b) => `${b.attempted} / ${b.sent}`)}
        ${row('Server acknowledgements', (b) => String(b.acknowledged))}
        ${row('Unacknowledged at results', (b) => `${b.unacknowledged}${b.sent ? ` (${(100 * b.unacknowledged / b.sent).toFixed(1)}%)` : ''}`)}
        ${row('Simulated outgoing drops', (b) => `${b.dropped}${b.attempted ? ` (${(100 * b.dropped / b.attempted).toFixed(1)}%)` : ''}`)}
        ${row('Average / highest RTT', (b) => `${number(b.rtt)} / ${b.acknowledged ? number(b.rttMax, ' ms') : '\u2014'}`)}
        ${row('RTT jitter', (b) => number(b.jitter, ' ms'))}
        ${row('Updates sent per second', (b) => number(b.rate))}
        ${row('Payload sent', (b) => number(b.bytes / 1024, ' KiB'))}
        ${row('Payload per second', (b) => number(b.kibPerSecond, ' KiB/s'))}
        ${row('Peer updates received / stale', (b) => `${b.received} / ${b.stale}`)}
        <tr class="network-theory"><th scope="row">Delivery model</th><td>Reliable, ordered stream</td><td>Datagrams; may be lost or reordered</td></tr>
        <tr class="network-theory"><th scope="row">When data is lost</th><td>Retransmits; newer data can wait</td><td>No automatic retry; next update can continue</td></tr>
      </tbody></table>
    <p class="network-notes">RTT = update sent \u2192 server acknowledgement received. Jitter = average absolute change between successive RTT samples. Unacknowledged updates may be delayed, lost, or have a missing reply; this is not a measurement of IP packet loss. Counts are application messages. Payload excludes headers, replies, heartbeats and TCP retransmissions. Host payload also includes bots.</p>
    <p class="network-notes">${stats.tcp.seconds && stats.udp.seconds
      ? 'These are different portions of the same race. Compare similar durations; local networks may show little difference. The loss demo affects UDP only and is not a controlled TCP loss test.'
      : 'Try both protocols during the next race to fill both columns. You can collect acknowledgements even when racing alone with bots.'}</p>
    <p class="network-notes">Race-time share uses the total measured time. Sent-update share uses all updates actually sent across both protocols. Confirmation percentage = server acknowledgements divided by sent updates; it excludes simulated drops and is not an overall performance score. A dash means there is no measurement. Browser response times include the WebSocket bridge.</p>
    </details>
  </section>`;
}
