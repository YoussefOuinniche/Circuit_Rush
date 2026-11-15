import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkStats } from '../client/game/src/network-stats.mjs';
import { networkReport } from '../client/game/src/network-report.mjs';

test('switching attributes late ACKs to the original protocol, with measured RTT and jitter', () => {
  let clock = 0;
  const stats = new NetworkStats(() => clock);
  stats.sent(99, 100, false); // countdown is excluded
  stats.start(); stats.sent(1, 100, false);
  clock = 20; stats.acknowledge(1, 'udp');
  stats.sent(2, 120, false); stats.sent(3, 120, true);
  clock = 50; stats.switch('tcp'); stats.sent(4, 80, false);
  clock = 60; stats.acknowledge(2, 'tcp'); // cannot acknowledge the wrong transport
  stats.acknowledge(2, 'udp'); stats.acknowledge(2, 'udp'); // duplicate ignored
  clock = 80; stats.stop();
  clock = 90; stats.acknowledge(4, 'tcp'); // late ACK after finish still counted
  const s = stats.snapshot();
  assert.equal(s.udp.seconds, .05); assert.equal(s.tcp.seconds, .03);
  assert.equal(s.udp.attempted, 3); assert.equal(s.udp.sent, 2); assert.equal(s.udp.dropped, 1);
  assert.equal(s.udp.bytes, 220); assert.equal(s.udp.acknowledged, 2);
  assert.equal(s.udp.rtt, 30); assert.equal(s.udp.jitter, 20); assert.equal(s.udp.rttMax, 40);
  assert.equal(s.tcp.rtt, 40); assert.equal(s.tcp.unacknowledged, 0);
  assert.equal(s.tcp.jitter, null);
  clock = 500; assert.equal(stats.snapshot().tcp.seconds, .03);
});

test('repeated switches, missing replies, stale incoming updates and reset', () => {
  let clock = 0;
  const stats = new NetworkStats(() => clock);
  stats.start(); stats.sent(0, 50, false);
  stats.receive('udp', false); stats.receive('udp', true);
  clock = 100; stats.switch('tcp');
  clock = 200; stats.switch('udp');
  clock = 300; stats.stop();
  const s = stats.snapshot();
  assert.equal(s.udp.seconds, .2); assert.equal(s.tcp.seconds, .1);
  assert.equal(s.udp.unacknowledged, 1); assert.equal(s.udp.rtt, null);
  assert.equal(s.udp.received, 2); assert.equal(s.udp.stale, 1);
  stats.receive('tcp', false); assert.equal(stats.snapshot().tcp.received, 0);
  stats.reset(); stats.acknowledge(0, 'udp');
  assert.equal(stats.snapshot().udp.sent, 0); assert.equal(stats.snapshot().udp.acknowledged, 0);
  assert.equal(stats.active, false); assert.equal(stats.protocol, 'udp');
});

test('report shows unused protocols and browser limitations without inventing values', () => {
  const stats = new NetworkStats(() => 0).snapshot();
  const report = networkReport(stats, true);
  assert.match(report, /Not sampled/); assert.match(report, /WebSocket\/TCP/);
  assert.match(report, /not a measurement of IP packet loss/);
  assert.doesNotMatch(report, /NaN|Infinity/);
  assert.match(networkReport(stats, false), /Direct sockets/);
});

test('summary separates usage shares, confirmed sends and simulated drops', () => {
  let clock = 0;
  const stats = new NetworkStats(() => clock);
  stats.start();
  for (let i = 0; i < 5; i++) stats.sent(i, 100, i === 4);
  clock = 10;
  for (let i = 0; i < 4; i++) stats.acknowledge(i, 'udp');
  clock = 20000; stats.switch('tcp');
  for (let i = 5; i < 11; i++) stats.sent(i, 100, false);
  clock = 20012;
  for (let i = 5; i < 8; i++) stats.acknowledge(i, 'tcp');
  clock = 100000; stats.stop();
  const summary = networkReport(stats.snapshot(), false).split('<details')[0];
  assert.match(summary, /Share of race time<\/th><td>80\.0%<\/td><td>20\.0%/);
  assert.match(summary, /Share of sent updates<\/th><td>60\.0%<\/td><td>40\.0%/);
  assert.match(summary, /Server reply received<\/small><\/th><td>50\.0%<\/td><td>100\.0%/);
  assert.match(summary, /UDP had a 2\.0 ms lower average response time/);
  assert.match(summary, /deliberately skipped before sending/);
  assert.doesNotMatch(summary, /RTT jitter|Payload sent/);
});
