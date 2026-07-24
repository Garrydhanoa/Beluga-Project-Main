/**
 * SSRF guard for outbound fetches of user-supplied URLs (AI vision image/link fetches).
 *
 * A guild member can @-mention the bot with a URL, which the server then fetches. Without
 * validation that lets them make the bot's host hit internal targets — cloud metadata
 * (169.254.169.254), Railway's private network (*.railway.internal), loopback, RFC1918.
 *
 * assertSafeUrl() rejects non-http(s) schemes, blocked hostnames, and any URL whose host
 * (literal IP or DNS-resolved address) falls in a private / loopback / link-local /
 * reserved range. safeFetch() additionally re-validates on each redirect hop so an
 * allowed host can't 3xx-redirect into an internal address.
 */
const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);
const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost'];

function ipv4ToInt(ip) {
    return ip.split('.').reduce((acc, oct) => ((acc << 8) + (parseInt(oct, 10) & 255)) >>> 0, 0);
}

function inRange4(ip, base, maskBits) {
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

// Private, loopback, link-local, CGNAT, benchmarking, multicast, reserved, broadcast.
const V4_BLOCKS = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
];

function isPrivateIpv4(ip) {
    return V4_BLOCKS.some(([base, bits]) => inRange4(ip, base, bits));
}

function isPrivateIpv6(ip) {
    const addr = ip.toLowerCase();
    if (addr === '::1' || addr === '::') return true;
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateIpv4(mapped[1]);
    if (/^f[cd]/.test(addr)) return true;      // fc00::/7 unique-local
    if (/^fe[89ab]/.test(addr)) return true;   // fe80::/10 link-local
    return false;
}

function isPrivateIp(ip) {
    const fam = net.isIP(ip);
    if (fam === 4) return isPrivateIpv4(ip);
    if (fam === 6) return isPrivateIpv6(ip);
    return true; // not a parseable IP -> treat as unsafe
}

async function assertSafeUrl(rawUrl) {
    let u;
    try {
        u = new URL(rawUrl);
    } catch {
        throw new Error('SSRF: invalid URL');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error(`SSRF: blocked protocol ${u.protocol}`);
    }
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTNAMES.has(host)) throw new Error('SSRF: blocked hostname');
    if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new Error('SSRF: blocked host suffix');

    if (net.isIP(host)) {
        if (isPrivateIp(host)) throw new Error('SSRF: blocked IP literal');
        return;
    }

    let addrs;
    try {
        addrs = await dns.lookup(host, { all: true });
    } catch {
        throw new Error('SSRF: DNS resolution failed');
    }
    if (!addrs || addrs.length === 0) throw new Error('SSRF: no DNS result');
    for (const a of addrs) {
        if (isPrivateIp(a.address)) throw new Error('SSRF: host resolves to private IP');
    }
}

const _fetch = global.fetch || require('node-fetch');

/**
 * Validate + fetch, re-checking every redirect hop. Pass through normal fetch options.
 */
async function safeFetch(rawUrl, options = {}, { maxRedirects = 3 } = {}) {
    let url = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        await assertSafeUrl(url);
        const res = await _fetch(url, { ...options, redirect: 'manual' });
        const status = res.status;
        if (status >= 300 && status < 400) {
            const loc = res.headers.get('location');
            if (!loc) return res;
            url = new URL(loc, url).toString();
            continue;
        }
        return res;
    }
    throw new Error('SSRF: too many redirects');
}

module.exports = { assertSafeUrl, safeFetch, isPrivateIp };
