/**
 * ===============================================
 *  虎牙每日助手 · Quantumult X 主任务脚本
 * ===============================================
 *  功能：粉丝团打卡 + 领取每日福利虎粮 + 赠送虎粮
 *  协议：虎牙官方 WUP(JCE) 二进制协议，直连 wup.huya.com
 *
 *  [task_local]
 *  0 9 * * * huya.task.js
 *
 *  配置说明（二选一）：
 *  1. 修改下方 DEFAULT_ROOMS（格式：房间号:送粮数量,房间号  数量为 0 或省略 = 送出全部）
 *  2. 通过 BoxJS / 持久化存储写入 key = HY_ROOMS_QX （值同上格式）
 * ===============================================
 */

'use strict';

/* ============ 用户配置 ============ */
const CONFIG = {
  COOKIE_KEY: 'HY_COOKIE_QX',        // 持久化存储的 Cookie key（由 huya.cookie.js 自动写入）
  ROOMS_KEY: 'HY_ROOMS_QX',          // 持久化存储的房间配置 key
  DEFAULT_ROOMS: '20641:',                 // 例: '518512:70,1964' （留空则读取 ROOMS_KEY）
  DIRECT_BINARY: false,              // 已废弃，由 WUP_TRANSPORT 取代
  WUP_TRANSPORT: 'auto',             // WUP 传输通道: 'auto' 自动降级标定 / 'relay' / 'direct-buffer' / 'direct-bodybytes'
  SEND_ALL_WHEN_ZERO: true,          // 未配置送粮数量时，是否送出全部虎粮
};

/* ============ 协议常量（逆向自虎牙客户端，已实测验证） ============ */
const WUP_URL = 'https://wup.huya.com/';
const HTTP_UA = 'Mozilla/5.0 (Linux; Android 14; 22011211C Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36/HuYa-android-12.7.4-6019-14-12007040';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 huya ios/13.5.20/store/27.0.1';

const UA_APP_SIGN = 'android&12.7.4&official&34';      // 打卡协议 UA
const UA_APP_WELFARE = 'android&13.4.63&official&35';  // 领福利协议 UA
const UA_WEBH5 = 'webh5&1.0.0&huya';                   // 网页端送礼 UA
const DEVICE_MODEL = '22011211C';
const SEQUENCE_APP_KEY = 'AzCXiouW6aLc4AsVGKAOOLlNLawNQsuV';
const CONSUME_GIFT_KEY = 'Hi2UfWa8LhRM07ZjucWL9wzuX7okmGvd';
const FROM_TYPE = 5;
const BUSINESS_TYPE = 1;

const WELFARE_DESC = { 1: '未达到领取条件', 2: '计时中', 3: '可领取', 4: '今日已领取' };

/* ================================================================
 *  基础工具：UTF-8 编解码 / Base64 / MD5
 * ================================================================ */
function utf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes) {
  let out = '', i = 0;
  while (i < bytes.length) {
    const c = bytes[i];
    let cp;
    if (c < 0x80) { cp = c; i += 1; }
    else if (c < 0xe0) { cp = ((c & 31) << 6) | (bytes[i + 1] & 63); i += 2; }
    else if (c < 0xf0) { cp = ((c & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
    else { cp = ((c & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4; }
    out += String.fromCodePoint(cp);
  }
  return out;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 63];
  }
  return out;
}

function b64decode(str) {
  const clean = String(str).replace(/=+$/, '');
  const out = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_CHARS.indexOf(clean[i]);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/* ---- MD5（myersdaily md5cycle 实现，输入为 UTF-8 字节数组，输出 hex） ---- */
function md5(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return hex_md5(s);
}

function hex_md5(s) { return rstr2hex(binl2rstr(md51(s))); }

function md5cycle(x, k) {
  let a = x[0], b = x[1], c = x[2], d = x[3];
  a = md5_ff(a, b, c, d, k[0], 7, -680876936);
  d = md5_ff(d, a, b, c, k[1], 12, -389564586);
  c = md5_ff(c, d, a, b, k[2], 17, 606105819);
  b = md5_ff(b, c, d, a, k[3], 22, -1044525330);
  a = md5_ff(a, b, c, d, k[4], 7, -176418897);
  d = md5_ff(d, a, b, c, k[5], 12, 1200080426);
  c = md5_ff(c, d, a, b, k[6], 17, -1473231341);
  b = md5_ff(b, c, d, a, k[7], 22, -45705983);
  a = md5_ff(a, b, c, d, k[8], 7, 1770035416);
  d = md5_ff(d, a, b, c, k[9], 12, -1958414417);
  c = md5_ff(c, d, a, b, k[10], 17, -42063);
  b = md5_ff(b, c, d, a, k[11], 22, -1990404162);
  a = md5_ff(a, b, c, d, k[12], 7, 1804603682);
  d = md5_ff(d, a, b, c, k[13], 12, -40341101);
  c = md5_ff(c, d, a, b, k[14], 17, -1502002290);
  b = md5_ff(b, c, d, a, k[15], 22, 1236535329);
  a = md5_gg(a, b, c, d, k[1], 5, -165796510);
  d = md5_gg(d, a, b, c, k[6], 9, -1069501632);
  c = md5_gg(c, d, a, b, k[11], 14, 643717713);
  b = md5_gg(b, c, d, a, k[0], 20, -373897302);
  a = md5_gg(a, b, c, d, k[5], 5, -701558691);
  d = md5_gg(d, a, b, c, k[10], 9, 38016083);
  c = md5_gg(c, d, a, b, k[15], 14, -660478335);
  b = md5_gg(b, c, d, a, k[4], 20, -405537848);
  a = md5_gg(a, b, c, d, k[9], 5, 568446438);
  d = md5_gg(d, a, b, c, k[14], 9, -1019803690);
  c = md5_gg(c, d, a, b, k[3], 14, -187363961);
  b = md5_gg(b, c, d, a, k[8], 20, 1163531501);
  a = md5_gg(a, b, c, d, k[13], 5, -1444681467);
  d = md5_gg(d, a, b, c, k[2], 9, -51403784);
  c = md5_gg(c, d, a, b, k[7], 14, 1735328473);
  b = md5_gg(b, c, d, a, k[12], 20, -1926607734);
  a = md5_hh(a, b, c, d, k[5], 4, -378558);
  d = md5_hh(d, a, b, c, k[8], 11, -2022574463);
  c = md5_hh(c, d, a, b, k[11], 16, 1839030562);
  b = md5_hh(b, c, d, a, k[14], 23, -35309556);
  a = md5_hh(a, b, c, d, k[1], 4, -1530992060);
  d = md5_hh(d, a, b, c, k[4], 11, 1272893353);
  c = md5_hh(c, d, a, b, k[7], 16, -155497632);
  b = md5_hh(b, c, d, a, k[10], 23, -1094730640);
  a = md5_hh(a, b, c, d, k[13], 4, 681279174);
  d = md5_hh(d, a, b, c, k[0], 11, -358537222);
  c = md5_hh(c, d, a, b, k[3], 16, -722521979);
  b = md5_hh(b, c, d, a, k[6], 23, 76029189);
  a = md5_hh(a, b, c, d, k[9], 4, -640364487);
  d = md5_hh(d, a, b, c, k[12], 11, -421815835);
  c = md5_hh(c, d, a, b, k[15], 16, 530742520);
  b = md5_hh(b, c, d, a, k[2], 23, -995338651);
  a = md5_ii(a, b, c, d, k[0], 6, -198630844);
  d = md5_ii(d, a, b, c, k[7], 10, 1126891415);
  c = md5_ii(c, d, a, b, k[14], 15, -1416354905);
  b = md5_ii(b, c, d, a, k[5], 21, -57434055);
  a = md5_ii(a, b, c, d, k[12], 6, 1700485571);
  d = md5_ii(d, a, b, c, k[3], 10, -1894986606);
  c = md5_ii(c, d, a, b, k[10], 15, -1051523);
  b = md5_ii(b, c, d, a, k[1], 21, -2054922799);
  a = md5_ii(a, b, c, d, k[8], 6, 1873313359);
  d = md5_ii(d, a, b, c, k[15], 10, -30611744);
  c = md5_ii(c, d, a, b, k[6], 15, -1560198380);
  b = md5_ii(b, c, d, a, k[13], 21, 1309151649);
  a = md5_ii(a, b, c, d, k[4], 6, -145523070);
  d = md5_ii(d, a, b, c, k[11], 10, -1120210379);
  c = md5_ii(c, d, a, b, k[2], 15, 718787259);
  b = md5_ii(b, c, d, a, k[9], 21, -343485551);
  x[0] = safe_add(a, x[0]);
  x[1] = safe_add(b, x[1]);
  x[2] = safe_add(c, x[2]);
  x[3] = safe_add(d, x[3]);
}

function md5blk(s) {
  const blks = [];
  for (let i = 0; i < 64; i += 4) {
    blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
  }
  return blks;
}

function md51(s) {
  const n = s.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 64; i <= n; i += 64) {
    md5cycle(state, md5blk(s.substring(i - 64, i)));
  }
  s = s.substring(i - 64);
  const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
  tail[i >> 2] |= 0x80 << ((i % 4) << 3);
  if (i > 55) {
    md5cycle(state, tail);
    for (i = 0; i < 16; i++) tail[i] = 0;
  }
  tail[14] = n * 8;
  md5cycle(state, tail);
  return state;
}

function rstr2hex(input) {
  const hexTab = '0123456789abcdef';
  let output = '';
  for (let i = 0; i < input.length; i++) {
    const x = input.charCodeAt(i);
    output += hexTab[(x >>> 4) & 0x0f] + hexTab[x & 0x0f];
  }
  return output;
}
function binl2rstr(input) {
  let output = '';
  for (let i = 0; i < input.length * 4; i++) output += String.fromCharCode((input[i >> 2] >>> ((i % 4) * 8)) & 0xff);
  return output;
}
function md5_cmn(q, a, b, x, s, t) { return safe_add(bit_rol(safe_add(safe_add(a, q), safe_add(x, t)), s), b); }
function md5_ff(a, b, c, d, x, s, t) { return md5_cmn((b & c) | (~b & d), a, b, x, s, t); }
function md5_gg(a, b, c, d, x, s, t) { return md5_cmn((b & d) | (c & ~d), a, b, x, s, t); }
function md5_hh(a, b, c, d, x, s, t) { return md5_cmn(b ^ c ^ d, a, b, x, s, t); }
function md5_ii(a, b, c, d, x, s, t) { return md5_cmn(c ^ (b | ~d), a, b, x, s, t); }
function safe_add(x, y) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
function bit_rol(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }

/* ---- 纯 JS gzip 解压（tiny-inflate: raw DEFLATE + RFC1952 容器解析） ---- */
const MAXBITS = 15;
const MAXLCODES = 286;
const MAXDCODES = 30;
const MAXCODES = MAXLCODES + MAXDCODES;
const FIXLCODES = 288;

function _inflateBuildHuffman(lengths, n, s) {
  let symbol, len, left;
  const offs = new Array(MAXBITS + 1);
  for (len = 0; len <= MAXBITS; len++) s.count[len] = 0;
  for (symbol = 0; symbol < n; symbol++) s.count[lengths[symbol]]++;
  if (s.count[0] === n) return 0;
  left = 1;
  for (len = 1; len <= MAXBITS; len++) { left <<= 1; left -= s.count[len]; if (left < 0) return left; }
  offs[1] = 0;
  for (len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + s.count[len];
  for (symbol = 0; symbol < n; symbol++) if (lengths[symbol] !== 0) s.symbol[offs[lengths[symbol]]++] = symbol;
  return left;
}

function _inflateDecode(s, h) {
  let code = 0, first = 0, index = 0, len;
  for (len = 1; len <= MAXBITS; len++) {
    code |= s.getBit();
    const count = h.count[len];
    if (code - count < first) return h.symbol[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  return -10;
}

function tinyInflate(src, dst) {
  let bitbuf = 0, bitcnt = 0, pos = 0, outPos = 0;
  const s = {
    getBit() {
      if (bitcnt === 0) {
        bitbuf = pos < src.length ? src[pos++] : 0;
        bitcnt = 8;
      }
      const bit = bitbuf & 1;
      bitbuf >>= 1;
      bitcnt--;
      return bit;
    },
  };
  s.getBit = s.getBit.bind(s);

  function bits(need) {
    let val = bitbuf;
    while (bitcnt < need) {
      if (pos >= src.length) return -1;
      val |= src[pos++] << bitcnt;
      bitcnt += 8;
    }
    bitbuf = val >> need;
    bitcnt -= need;
    return val & ((1 << need) - 1);
  }

  const lencnt = new Array(MAXBITS + 1).fill(0);
  const lensym = new Array(MAXLCODES);
  const distcnt = new Array(MAXBITS + 1).fill(0);
  const distsym = new Array(MAXDCODES);
  const lens = new Array(MAXCODES + 9).fill(0);
  const fixedLit = { count: lencnt, symbol: lensym };
  const fixedDist = { count: distcnt, symbol: distsym };
  let fixedBuilt = false;

  const lengthsTab = new Array(FIXLCODES);
  function buildFixed() {
    if (fixedBuilt) return 0;
    let symbol;
    for (symbol = 0; symbol < 144; symbol++) lengthsTab[symbol] = 8;
    for (; symbol < 256; symbol++) lengthsTab[symbol] = 9;
    for (; symbol < 280; symbol++) lengthsTab[symbol] = 7;
    for (; symbol < FIXLCODES; symbol++) lengthsTab[symbol] = 8;
    _inflateBuildHuffman(lengthsTab, FIXLCODES, fixedLit);
    for (symbol = 0; symbol < MAXDCODES; symbol++) lengthsTab[symbol] = 5;
    _inflateBuildHuffman(lengthsTab, MAXDCODES, fixedDist);
    fixedBuilt = true;
    return 0;
  }

  const distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const lenBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const lenExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

  const litH = { count: new Array(MAXBITS + 1).fill(0), symbol: new Array(MAXLCODES) };
  const distH = { count: new Array(MAXBITS + 1).fill(0), symbol: new Array(MAXDCODES) };

  function codes(litHuf, distHuf) {
    for (;;) {
      let symbol = _inflateDecode(s, litHuf);
      if (symbol < 0) return symbol;
      if (symbol < 256) {
        if (outPos >= dst.length) return -5;
        dst[outPos++] = symbol;
      } else if (symbol > 256) {
        symbol -= 257;
        if (symbol >= 29) return -10;
        const extraBits = lenExtra[symbol];
        const len = lenBase[symbol] + (extraBits ? bits(extraBits) : 0);
        const dsym = _inflateDecode(s, distHuf);
        if (dsym < 0) return dsym;
        if (dsym > 29) return -10;
        const dist = distBase[dsym] + (distExtra[dsym] ? bits(distExtra[dsym]) : 0);
        if (dist > outPos) return -11;
        for (let i = 0; i < len; i++) {
          if (outPos >= dst.length) return -5;
          dst[outPos] = dst[outPos - dist];
          outPos++;
        }
      } else break; // 256 = end of block
    }
    return 0;
  }

  function stored() {
    bitbuf = 0; bitcnt = 0; // 对齐字节边界
    if (pos + 4 > src.length) return -4;
    const len = src[pos] | (src[pos + 1] << 8);
    const nlen = src[pos + 2] | (src[pos + 3] << 8);
    pos += 4;
    if ((~len & 0xffff) !== (nlen & 0xffff)) return -3;
    if (pos + len > src.length) return -4;
    for (let i = 0; i < len; i++) {
      if (outPos >= dst.length) return -5;
      dst[outPos++] = src[pos++];
    }
    return 0;
  }

  function dynamic() {
    const nlen = bits(5) + 257;
    const ndist = bits(5) + 1;
    const ncode = bits(4) + 4;
    if (nlen > MAXLCODES || ndist > MAXDCODES) return -3;
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    let index;
    for (index = 0; index < ncode; index++) lens[order[index]] = bits(3);
    for (; index < 19; index++) lens[order[index]] = 0;
    const codeHuf = { count: new Array(MAXBITS + 1).fill(0), symbol: new Array(19) };
    const e0 = _inflateBuildHuffman(lens, 19, codeHuf);
    if (e0 !== 0) return -5;

    index = 0;
    while (index < nlen + ndist) {
      let symbol = _inflateDecode(s, codeHuf);
      if (symbol < 0) return symbol;
      if (symbol < 16) lens[index++] = symbol;
      else {
        let len = 0, rep;
        if (symbol === 16) { if (index === 0) return -5; len = lens[index - 1]; rep = 3 + bits(2); }
        else if (symbol === 17) { rep = 3 + bits(3); }
        else { rep = 11 + bits(7); }
        if (index + rep > nlen + ndist) return -5;
        while (rep--) lens[index++] = len;
      }
    }
    const e1 = _inflateBuildHuffman(lens, nlen, litH);
    if (e1 < 0) return e1;
    const distLens = lens.slice(nlen, nlen + ndist);
    const e2d = _inflateBuildHuffman(distLens, ndist, distH);
    if (e2d < 0) return e2d;
    return codes(litH, distH);
  }

  let last, err = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) err = stored();
    else if (type === 1) { buildFixed(); err = codes(fixedLit, fixedDist); }
    else if (type === 2) err = dynamic();
    else err = -2;
    if (err !== 0) return err;
  } while (!last);
  return outPos;
}

function gunzip(data) {
  // RFC1952 header
  let p = 0;
  if (data[0] !== 0x1f || data[1] !== 0x8b) throw new Error('非 gzip 数据');
  const flg = data[3];
  p = 10;
  if (flg & 4) { const xlen = data[p] | (data[p + 1] << 8); p += 2 + xlen; }   // FEXTRA
  if (flg & 8) { while (p < data.length && data[p] !== 0) p++; p++; }          // FNAME
  if (flg & 16) { while (p < data.length && data[p] !== 0) p++; p++; }         // FCOMMENT
  if (flg & 2) p += 2;                                                        // FHCRC
  // ISIZE 位于末尾 4 字节（解压后长度 mod 2^32）
  const isize = (data[data.length - 4] | (data[data.length - 3] << 8) | (data[data.length - 2] << 16) | (data[data.length - 1] << 24)) >>> 0;
  const out = new Uint8Array(Math.min(isize, 64 * 1024 * 1024) || 1024);
  const n = tinyInflate(data.subarray(p, data.length - 8), out);
  if (n < 0) throw new Error('gzip 解压失败 code=' + n);
  return out.subarray(0, n);
}
class JceOutputStream {
  constructor() { this.buf = []; }
  _head(tag, type) {
    if (tag < 15) this.buf.push((tag << 4) | type);
    else { this.buf.push((15 << 4) | type); this.buf.push(tag & 0xff); }
  }
  writeRaw(bytes) { for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]); }
  writeByte(v, tag) {
    if (v === 0) this._head(tag, 12);
    else { this._head(tag, 0); this.buf.push(v & 0xff); }
  }
  writeShort(v, tag) {
    if (v >= -128 && v <= 127) this.writeByte(v, tag);
    else { this._head(tag, 1); this.buf.push((v >> 8) & 0xff, v & 0xff); }
  }
  writeInt(v, tag) {
    if (v >= -32768 && v <= 32767) this.writeShort(v, tag);
    else { this._head(tag, 2); this.buf.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); }
  }
  writeLong(v, tag) {
    if (v >= -2147483648 && v <= 2147483647) { this.writeInt(v, tag); return; }
    this._head(tag, 3);
    const neg = v < 0;
    const abs = neg ? -v : v;
    const hi = Math.floor(abs / 4294967296), lo = abs % 4294967296;
    const bytes = [(hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
                   (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
    if (neg) for (let i = 7; i >= 0; i--) { let t = 256 - bytes[i]; bytes[i] = t & 0xff; if (t <= 256 && bytes[i] !== 0) { if (t === 256) { continue; } break; } }
    this.buf.push.apply(this.buf, bytes);
  }
  writeString(v, tag) {
    const b = utf8Encode(String(v));
    if (b.length > 255) { this._head(tag, 7); this.buf.push((b.length >>> 24) & 0xff, (b.length >>> 16) & 0xff, (b.length >>> 8) & 0xff, b.length & 0xff); }
    else { this._head(tag, 6); this.buf.push(b.length); }
    this.writeRaw(b);
  }
  writeBytes(val, tag) {
    this._head(tag, 13);
    this.buf.push(0);
    this.writeInt(val.length, 0);
    this.writeRaw(val);
  }
  writeMapStrBytes(m, tag) {
    this._head(tag, 8);
    const keys = Object.keys(m);
    this.writeInt(keys.length, 0);
    for (const k of keys) { this.writeString(k, 0); this.writeBytes(m[k], 1); }
  }
  writeMapStrStr(m, tag) {
    this._head(tag, 8);
    const keys = Object.keys(m);
    this.writeInt(keys.length, 0);
    for (const k of keys) { this.writeString(k, 0); this.writeString(m[k], 1); }
  }
  structBegin(tag) { this._head(tag, 10); }
  structEnd() { this._head(0, 11); }
  toBytes() { return Uint8Array.from(this.buf); }
}

class JceInputStream {
  constructor(data) {
    this.d = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.pos = 0;
  }
  readHead() {
    if (this.pos >= this.d.length) return null;
    const b = this.d[this.pos++];
    let type = b & 0x0f, tag = (b >> 4) & 0x0f;
    if (tag === 15) {
      if (this.pos >= this.d.length) return null;
      tag = this.d[this.pos++];
    }
    return { tag: tag, type: type };
  }
  readVal(type) {
    const d = this.d;
    switch (type) {
      case 12: return 0;
      case 0: { let v = d[this.pos++]; if (v > 127) v -= 256; return v; }
      case 1: { let v = (d[this.pos] << 8) | d[this.pos + 1]; this.pos += 2; if (v > 32767) v -= 65536; return v; }
      case 2: { let v = 0; for (let i = 0; i < 4; i++) v = v * 256 + d[this.pos + i]; this.pos += 4; if (v > 2147483647) v -= 4294967296; return v; }
      case 3: { let hi = 0, lo = 0; for (let i = 0; i < 4; i++) hi = hi * 256 + d[this.pos + i]; for (let i = 4; i < 8; i++) lo = lo * 256 + d[this.pos + i]; this.pos += 8; return hi * 4294967296 + lo; }
      case 4: { const v = new DataView(this.d.buffer, this.d.byteOffset + this.pos).getFloat32(0); this.pos += 4; return v; }
      case 5: { const v = new DataView(this.d.buffer, this.d.byteOffset + this.pos).getFloat64(0); this.pos += 8; return v; }
      case 6: { const l = d[this.pos++]; const s = utf8Decode(d.subarray(this.pos, this.pos + l)); this.pos += l; return s; }
      case 7: { let l = 0; for (let i = 0; i < 4; i++) l = l * 256 + d[this.pos + i]; this.pos += 4; const s = utf8Decode(d.subarray(this.pos, this.pos + l)); this.pos += l; return s; }
      case 8: {
        const h = this.readHead(); const cnt = this.readVal(h.type); const m = {};
        for (let i = 0; i < cnt; i++) {
          const hk = this.readHead(); const k = this.readVal(hk.type);
          const hv = this.readHead(); const v = this.readVal(hv.type);
          m[k] = v;
        }
        return m;
      }
      case 9: {
        const h = this.readHead(); const cnt = this.readVal(h.type); const items = [];
        for (let i = 0; i < cnt; i++) { const hi = this.readHead(); items.push(this.readVal(hi.type)); }
        return items;
      }
      case 10: {
        const obj = {};
        for (;;) {
          const h = this.readHead();
          if (!h || h.type === 11) break;
          obj[h.tag] = this.readVal(h.type);
        }
        return obj;
      }
      case 13: {
        this.pos += 1; // 元素类型字节
        const h = this.readHead(); const l = this.readVal(h.type);
        const raw = this.d.subarray(this.pos, this.pos + l); this.pos += l;
        return new Uint8Array(raw);
      }
      default: return null;
    }
  }
  parseAll() {
    const res = {};
    for (;;) {
      const h = this.readHead();
      if (!h) break;
      res[h.tag] = this.readVal(h.type);
    }
    return res;
  }
}

/* ================================================================
 *  WUP 请求封装
 * ================================================================ */
function buildWup(servant, func, reqBytes) {
  const s = new JceOutputStream();
  s.writeMapStrBytes({ tReq: reqBytes }, 0);
  const rp = new JceOutputStream();
  rp.writeShort(3, 1);      // iVersion
  rp.writeByte(0, 2);       // cPacketType
  rp.writeInt(0, 3);        // iMessageType
  rp.writeInt(1, 4);        // iRequestId
  rp.writeString(servant, 5);
  rp.writeString(func, 6);
  rp.writeBytes(s.toBytes(), 7);
  rp.writeInt(0, 8);        // iTimeout
  rp.writeMapStrStr({}, 9); // context
  rp.writeMapStrStr({}, 10); // status
  const payload = rp.toBytes();
  const out = new Uint8Array(payload.length + 4);
  out[0] = (payload.length + 4) >>> 24 & 0xff;
  out[1] = (payload.length + 4) >>> 16 & 0xff;
  out[2] = (payload.length + 4) >>> 8 & 0xff;
  out[3] = (payload.length + 4) & 0xff;
  out.set(payload, 4);
  return out;
}

function parseWupResponse(u8) {
  let body = u8;
  if (u8.length > 4) {
    const total = (u8[0] << 24 | u8[1] << 16 | u8[2] << 8 | u8[3]) >>> 0;
    if (total >= 4 && total <= u8.length) body = u8.slice(4, total);
  }
  const root = new JceInputStream(body).parseAll();
  const status = root[10] || {};
  const signal = String(status['SIGNAL_SERVICE_RET'] !== undefined ? status['SIGNAL_SERVICE_RET'] : '0');
  let tRsp = {};
  const sbuf = root[7];
  if (sbuf && sbuf.length) {
    const m = new JceInputStream(sbuf).parseAll()[0] || {};
    const t = m['tRsp'];
    if (t) tRsp = new JceInputStream(t).parseAll();
  }
  return { signal: signal, status: status, tRsp: tRsp };
}

/* ================================================================
 *  主逻辑
 * ================================================================ */
let COOKIE = '', UID = 0, PASSPORT = '', GUID = '';
let uidV1 = null, uidV2 = null, uidV3 = null;

function initUser(cookie) {
  COOKIE = cookie;
  const m = /yyuid=(\d+)/.exec(cookie) || /udb_uid=(\d+)/.exec(cookie);
  UID = m ? parseInt(m[1], 10) : 0;
  const pm = /username=([^;]+)/.exec(cookie);
  PASSPORT = pm ? pm[1] : '';
  const gm = /guid=([a-zA-Z0-9_-]+)/.exec(cookie);
  GUID = gm ? gm[1] : '';

  const build = (fn) => {
    const o = new JceOutputStream();
    o.structBegin(0);
    fn(o);
    o.structEnd();
    return o.toBytes().slice(1, o.toBytes().length - 1); // 去掉外层 struct 头尾，便于嵌入
  };
  uidV1 = build((o) => {           // 打卡客户端（guid 与 Python 参考实现一致：存在才写入）
    o.writeLong(UID, 0);
    if (GUID) o.writeString(GUID, 1);
    o.writeString(UA_APP_SIGN, 3);
    o.writeString(COOKIE, 4);
    o.writeInt(0, 5);
    o.writeString('Pixel 7', 6);
  });
  uidV2 = build((o) => {           // 福利客户端（App 通道）
    o.writeLong(UID, 0);
    o.writeString('', 1);
    o.writeString('', 2);
    o.writeString(UA_APP_WELFARE, 3);
    o.writeString(COOKIE, 4);
    o.writeInt(2, 5);
    o.writeString(DEVICE_MODEL, 6);
    o.writeString('', 7);
  });
  uidV3 = build((o) => {           // 网页端送礼客户端
    o.writeLong(UID, 0);
    o.writeString('', 1);
    o.writeString('', 2);
    o.writeString(UA_WEBH5, 3);
    o.writeString(COOKIE, 4);
    o.writeInt(0, 5);
  });
}

function embedUserId(o, raw, tag) {
  o.structBegin(tag);
  o.writeRaw(raw);
  o.structEnd();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function http(request) {
  return new Promise((resolve, reject) => {
    $task.fetch(request).then(resolve, (r) => reject(new Error((r && r.error) || '网络请求失败')));
  });
}

/* ---------- WUP 传输通道：自动降级 + 标定 ----------
 * 背景：圈X 对二进制请求体的支持无官方文档，且 wup 网关收到无效
 * 请求体时会挂起不响应（实测），所以每个通道都带硬超时。
 * 通道优先级：
 *   relay            请求体为 base64，由 huya.relay.js 重写还原为二进制
 *   direct-buffer    $task.fetch 直接发 ArrayBuffer（较新版本可能支持）
 *   direct-bodybytes $task.fetch 用 bodyBytes 选项
 * 首个只读调用自动标定可用通道并持久化（HY_WUP_TP），后续调用直用。
 */
const WUP_TIMEOUT_MS = 15000;
const WUP_TP_KEY = 'HY_WUP_TP';
const WUP_TP_ORDER = ['relay', 'direct-buffer', 'direct-bodybytes'];
let wupTransport = null;

function storeWrite(value, key) {
  try {
    if (typeof $prefs !== 'undefined' && $prefs.setValueForKey) { $prefs.setValueForKey(value, key); return; }
  } catch (e) {}
  try {
    if (typeof $persistentStore !== 'undefined') $persistentStore.write(value, key);
  } catch (e) {}
}

function storeRemove(key) {
  try {
    if (typeof $prefs !== 'undefined' && $prefs.removeValueForKey) { $prefs.removeValueForKey(key); return; }
  } catch (e) {}
  try {
    if (typeof $persistentStore !== 'undefined' && $persistentStore.write) $persistentStore.write('', key);
  } catch (e) {}
}

function httpWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('timeout(' + ms + 'ms)')); }
    }, ms);
    $task.fetch(request).then(
      (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error((e && e.error) || '网络请求失败')); } }
    );
  });
}

function wupAttempt(name, packet, headers) {
  if (name === 'relay') {
    const h = Object.assign({}, headers, { 'X-HY-Relay': '1' });
    return httpWithTimeout({ url: WUP_URL, method: 'POST', headers: h, body: b64encode(packet) }, WUP_TIMEOUT_MS);
  }
  if (name === 'direct-buffer') {
    // 精确切片，避免 buffer 越界
    const buf = packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength);
    return httpWithTimeout({ url: WUP_URL, method: 'POST', headers: headers, body: buf }, WUP_TIMEOUT_MS);
  }
  if (name === 'direct-bodybytes') {
    return httpWithTimeout({ url: WUP_URL, method: 'POST', headers: headers, bodyBytes: packet }, WUP_TIMEOUT_MS);
  }
  return Promise.reject(new Error('未知通道 ' + name));
}

function wupValidate(resp) {
  if (!resp) throw new Error('无响应');
  if (resp.statusCode !== 200) throw new Error('HTTP ' + resp.statusCode);
  const bb = resp.bodyBytes;
  if (!bb || !bb.byteLength) throw new Error('响应为空');
  let u8 = new Uint8Array(bb);
  // 服务器对部分接口强制 gzip，内置解压器处理
  if (u8.length > 3 && u8[0] === 0x1f && u8[1] === 0x8b) u8 = gunzip(u8);
  const parsed = parseWupResponse(u8);
  if (!parsed || typeof parsed.signal !== 'string') throw new Error('响应不是有效 WUP');
  return parsed;
}

async function wupCall(servant, func, reqBytes) {
  const packet = buildWup(servant, func, reqBytes);
  const headers = {
    'Content-Type': 'application/x-wup',
    'User-Agent': HTTP_UA,
    'Cookie': COOKIE,
    'Accept-Encoding': 'identity',
  };

  // 已标定通道：单次直用（失败即抛出，写操作绝不重试，避免重复执行）
  if (wupTransport) {
    const parsed = wupValidate(await wupAttempt(wupTransport, packet, headers));
    return parsed;
  }

  // 未标定：按优先级探测（只有关卡前的只读查询才会走到这里）
  let order = WUP_TP_ORDER.slice();
  const forced = CONFIG.WUP_TRANSPORT;
  if (forced && forced !== 'auto') {
    order = [forced];
  } else {
    const saved = storeRead(WUP_TP_KEY);
    if (saved && order.indexOf(saved) > 0) {
      order.splice(order.indexOf(saved), 1);
      order.unshift(saved); // 上次标定成功的通道优先试
    }
  }
  const errors = [];
  for (const name of order) {
    try {
      const parsed = wupValidate(await wupAttempt(name, packet, headers));
      wupTransport = name;
      if (!forced || forced === 'auto') storeWrite(name, WUP_TP_KEY);
      console.log('WUP 传输通道标定成功: ' + name);
      return parsed;
    } catch (e) {
      errors.push(name + ' → ' + e.message);
    }
  }
  storeRemove(WUP_TP_KEY);
  throw new Error('WUP 所有传输通道失败 [' + errors.join(' | ') + ']');
}

/* ---------- 房间元数据 ---------- */
async function fetchRoomMeta(roomId) {
  let html = '';
  // 优先 PC 直播页（含 lp/nick/profileRoom 字段）
  const respPc = await http({
    url: 'https://www.huya.com/' + roomId,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Encoding': 'identity' },
  });
  html = respPc.body || '';
  let mLp = /"lp"\s*:\s*"?(\d+)"?/.exec(html);
  // 兜底：移动版页面
  if (!mLp) {
    const respM = await http({
      url: 'https://m.huya.com/' + roomId,
      method: 'GET',
      headers: { 'User-Agent': MOBILE_UA, 'Accept-Encoding': 'identity' },
    });
    html = respM.body || '';
    mLp = /"lp"\s*:\s*"?(\d+)"?/.exec(html);
  }
  if (!mLp) throw new Error('房间号无法解析（房间不存在或已关闭）');
  const mNick = /"nick"\s*:\s*"([^"]+)"/.exec(html);
  const mRoom = /"profileRoom"\s*:\s*"?(\d+)"?/.exec(html);
  return { pid: parseInt(mLp[1], 10), nick: mNick ? mNick[1] : ('房间' + roomId), profileRoom: mRoom ? mRoom[1] : String(roomId) };
}

/* ---------- 打卡 ---------- */
function buildFansSignReq(pid) {
  const o = new JceOutputStream();
  o.structBegin(0);
  embedUserId(o, uidV1, 0);
  o.writeLong(pid, 1);
  o.structEnd();
  return o.toBytes();
}

function parseSignalResp(rsp) {
  const payload = rsp.tRsp[0] || {};
  return {
    ret: typeof payload[0] === 'number' ? payload[0] : -1,
    msg: String(payload[1] !== undefined ? payload[1] : ''),
    raw: payload,
  };
}

async function queryFansSign(pid) {
  const rsp = await wupCall('wupui', 'getFansSign', buildFansSignReq(pid));
  const payload = (rsp.tRsp[0] || {});
  const signInfo = payload[2] || {};
  return {
    signal: rsp.signal,
    ret: typeof payload[0] === 'number' ? payload[0] : -1,
    msg: String(payload[1] !== undefined ? payload[1] : ''),
    position: typeof signInfo[0] === 'number' ? signInfo[0] : 0,
    signFlags: typeof signInfo[2] === 'number' ? signInfo[2] : 0,
  };
}

async function doFansSign(pid) {
  const before = await queryFansSign(pid);
  if (before.signal !== '0' || before.ret !== 0) throw new Error('打卡状态查询失败(' + before.signal + '/' + before.ret + ')');
  if (before.position > 0 && (before.signFlags & (1 << (before.position - 1)))) {
    return { ok: true, already: true, msg: '今日已打卡' };
  }
  const rsp = await wupCall('wupui', 'setFansSign', buildFansSignReq(pid));
  const r = parseSignalResp(rsp);
  if (rsp.signal !== '0' || r.ret !== 0) throw new Error('打卡失败: ' + (r.msg || ('code ' + rsp.signal + '/' + r.ret)));
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    const after = await queryFansSign(pid);
    if (after.signal === '0' && after.ret === 0) {
      if (after.position > 0 && (after.signFlags & (1 << (after.position - 1)))) {
        return { ok: true, already: false, msg: '打卡成功(+5亲密度)' };
      }
    }
  }
  return { ok: false, already: false, msg: '打卡已提交但未确认' };
}

/* ---------- 领取每日福利（虎粮 x10） ---------- */
function buildWelfareReq(pid) {
  const o = new JceOutputStream();
  o.structBegin(0);
  embedUserId(o, uidV2, 0);
  o.writeLong(pid, 1);
  o.writeInt(3, 2);
  o.structEnd();
  return o.toBytes();
}

async function queryWelfare(pid) {
  const rsp = await wupCall('wupui', 'queryFansGroupTaskInfo', buildWelfareReq(pid));
  const payload = rsp.tRsp[0] || {};
  const day = payload[7] || {};
  return {
    signal: rsp.signal,
    ret: typeof payload[0] === 'number' ? payload[0] : -1,
    state: typeof day[0] === 'number' ? day[0] : 0,
  };
}

async function claimWelfare(pid) {
  const st = await queryWelfare(pid);
  if (st.signal !== '0' || st.ret !== 0) throw new Error('福利状态查询失败(' + st.signal + '/' + st.ret + ')');
  if (st.state === 4) return { ok: true, claimed: true, count: 0, msg: '今日已领取过福利' };
  if (st.state !== 3) return { ok: false, claimed: false, count: 0, msg: '暂不可领(' + (WELFARE_DESC[st.state] || ('状态' + st.state)) + ')' };

  const rsp = await wupCall('wupui', 'operateFansBox', buildWelfareReq(pid));
  const payload = rsp.tRsp[0] || {};
  const ret = typeof payload[0] === 'number' ? payload[0] : -1;
  if (rsp.signal !== '0' || (ret !== 0 && ret !== null)) {
    throw new Error('领取失败: ' + (rsp.status['STATUS_RESULT_DESC'] || ('code ' + rsp.signal + '/' + ret)));
  }
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    const after = await queryWelfare(pid);
    if (after.signal === '0' && after.ret === 0 && after.state === 4) {
      const count = typeof payload[5] === 'number' && payload[5] > 0 ? payload[5] : 10;
      return { ok: true, claimed: true, count: count, msg: '领取成功(虎粮x' + count + ')' };
    }
  }
  return { ok: false, claimed: false, count: 0, msg: '领取已提交但未确认' };
}

/* ---------- 虎粮库存 / 赠送 ---------- */
function buildPkgReq(pid) {
  const o = new JceOutputStream();
  o.structBegin(0);
  embedUserId(o, uidV3, 0);
  o.writeLong(pid, 1);
  o.structEnd();
  return o.toBytes();
}

async function queryPackage(pid) {
  const rsp = await wupCall('wupui', 'getPackageGift', buildPkgReq(pid));
  if (rsp.signal !== '0') throw new Error('库存查询失败(signal ' + rsp.signal + ')，Cookie 可能已失效');
  const payload = rsp.tRsp[0] || {};
  const gifts = payload[0] || [];
  for (const g of gifts) {
    if (!g || !g[0]) continue;
    const simple = g[0];
    if (String(simple[3]) === '虎粮') {
      return { itemType: typeof simple[0] === 'number' ? simple[0] : 0, count: typeof g[5] === 'number' ? g[5] : 0 };
    }
  }
  return { itemType: 0, count: 0 };
}

async function getSequence() {
  const sign = md5(utf8Encode(UID + '1' + FROM_TYPE + BUSINESS_TYPE + SEQUENCE_APP_KEY));
  const o = new JceOutputStream();
  o.structBegin(0);
  embedUserId(o, uidV3, 0);
  o.writeInt(1, 1);
  o.writeInt(FROM_TYPE, 2);
  o.writeInt(BUSINESS_TYPE, 3);
  o.writeString(sign, 4);
  o.structEnd();
  const rsp = await wupCall('sequenceui', 'getSequence', o.toBytes());
  const payload = rsp.tRsp[0] || {};
  const ret = typeof payload[0] === 'number' ? payload[0] : -1;
  const seq = String(payload[1] !== undefined ? payload[1] : '');
  if (rsp.signal !== '0' || ret !== 0 || !seq) throw new Error('获取送礼序列号失败(' + rsp.signal + '/' + ret + ')');
  return seq;
}

async function sendTigerFood(pid, itemType, count) {
  const payId = await getSequence();
  const roomId = 0, showFree = 0, payPolicy = 2, templateType = 5, eventType = 2;
  const giftSign = md5(utf8Encode(
    UID + String(roomId) + String(showFree) + itemType + count + pid + payId +
    payPolicy + FROM_TYPE + templateType + PASSPORT + eventType + CONSUME_GIFT_KEY
  ));
  const o = new JceOutputStream();
  o.structBegin(0);
  embedUserId(o, uidV3, 0);
  o.writeLong(roomId, 1);
  o.writeInt(showFree, 2);
  o.writeInt(itemType, 3);
  o.writeInt(count, 4);
  o.writeLong(pid, 5);
  o.writeLong(pid, 6);
  o.writeString(payId, 7);
  o.writeString('', 8);
  o.writeInt(payPolicy, 9);
  o.writeInt(FROM_TYPE, 10);
  o.writeString('', 11);
  o.writeInt(templateType, 12);
  o.writeString(PASSPORT, 13);
  o.writeShort(eventType, 14);
  o.writeString(giftSign, 15);
  o.writeInt(0, 16);
  o.writeInt(0, 17);
  o.writeInt(0, 18);
  o.writeMapStrStr({}, 19);
  o.writeString('', 20);
  o.writeString('', 21);
  o.structEnd();

  const rsp = await wupCall('PropsUIServer', 'consumeGiftSafe', o.toBytes());
  const payload = rsp.tRsp[0] || {};
  const payCode = typeof payload[0] === 'number' ? payload[0] : -1;
  const msg = String(payload[11] !== undefined ? payload[11] : '');
  if (rsp.signal !== '0' || payCode !== 0) {
    throw new Error('送粮失败: ' + (msg || ('signal ' + rsp.signal + ' payCode ' + payCode)) + '（房间可能未开播）');
  }
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    const after = await queryPackage(pid);
    if (after.itemType > 0 || after.count === 0) return after.count;
  }
  return null;
}

/* ---------- 勋章信息 ---------- */
async function queryBadge(pid) {
  const o = new JceOutputStream();
  o.structBegin(0);
  embedUserId(o, uidV1, 0);
  o.writeLong(UID, 1);
  o.writeInt(0, 2);
  o.writeLong(pid, 3);
  o.writeInt(0, 4);
  o.structEnd();
  const rsp = await wupCall('liveui', 'queryBadgeInfoList', o.toBytes());
  const payload = rsp.tRsp[0] || {};
  const list = payload[0] || [];
  for (const b of list) {
    if (!b) continue;
    if (b[1] === pid || b[1] === 0) {
      return {
        name: String(b[3] !== undefined ? b[3] : ''),
        level: typeof b[4] === 'number' ? b[4] : 0,
        current: typeof b[6] === 'number' ? b[6] : 0,
        next: typeof b[7] === 'number' ? b[7] : 0,
      };
    }
  }
  return null;
}

/* ---------- 持久化存储（圈X 原生 $prefs，兼容 $persistentStore） ---------- */
function storeRead(key) {
  try {
    if (typeof $prefs !== 'undefined' && $prefs.valueForKey) return $prefs.valueForKey(key) || '';
  } catch (e) {}
  try {
    if (typeof $persistentStore !== 'undefined') return $persistentStore.read(key) || '';
  } catch (e) {}
  return '';
}

/* ---------- 主流程 ---------- */
function parseRooms() {
  let text = CONFIG.DEFAULT_ROOMS || '';
  if (!text) {
    text = storeRead(CONFIG.ROOMS_KEY) || '';
  }
  const rooms = [];
  for (const part of String(text).split(',')) {
    const t = part.trim();
    if (!t) continue;
    const seg = t.split(':');
    const room = seg[0].trim();
    const count = seg.length > 1 ? parseInt(seg[1], 10) || 0 : 0;
    if (/^\d+$/.test(room)) rooms.push({ room: room, count: count });
  }
  return rooms;
}

async function main() {
  const lines = [];
  let cookie = storeRead(CONFIG.COOKIE_KEY);
  if (!cookie) {
    $notify('🐯 虎牙每日助手', '❌ 未获取到 Cookie', '请先按说明配置 [rewrite_local]，并在虎牙 App 打开任意活动页或用 Safari 登录 i.huya.com 触发抓取');
    $done();
    return;
  }
  if (!/yyuid=|udb_uid=/.test(cookie) || !/udb_biztoken=/.test(cookie)) {
    $notify('🐯 虎牙每日助手', '❌ Cookie 不完整', '缺少登录凭证(yyuid/udb_biztoken)，请重新在虎牙 App 内打开活动页抓取');
    $done();
    return;
  }
  initUser(cookie);

  const rooms = parseRooms();
  if (!rooms.length) {
    $notify('🐯 虎牙每日助手', '❌ 未配置房间号', '请修改脚本 CONFIG.DEFAULT_ROOMS 或在 BoxJS 中设置 ' + CONFIG.ROOMS_KEY + '（格式：房间号:数量,房间号）');
    $done();
    return;
  }

  console.log('虎牙助手启动，账号 UID=' + UID + '，房间配置=' + JSON.stringify(rooms));

  for (const room of rooms) {
    const line = { room: room.room, nick: '', daka: '', welfare: '', gift: '', left: null };
    try {
      const meta = await fetchRoomMeta(room.room);
      line.nick = meta.nick;
      console.log('房间 ' + room.room + ' => 主播 ' + meta.nick + ' (pid=' + meta.pid + ')');

      // 1. 打卡
      try {
        const dk = await doFansSign(meta.pid);
        line.daka = dk.msg;
      } catch (e) { line.daka = '失败: ' + e.message; }
      await sleep(300);

      // 2. 领福利
      try {
        const wf = await claimWelfare(meta.pid);
        line.welfare = wf.msg;
      } catch (e) { line.welfare = '失败: ' + e.message; }
      await sleep(300);

      // 3. 送虎粮
      try {
        const pkg = await queryPackage(meta.pid);
        if (pkg.signalCheck) { /* reserved */ }
        if (pkg.count <= 0) {
          line.gift = '包裹无虎粮';
          line.left = 0;
        } else if (pkg.itemType <= 0) {
          line.gift = '虎粮道具ID异常';
        } else {
          const sendCount = room.count > 0 ? Math.min(room.count, pkg.count) : (CONFIG.SEND_ALL_WHEN_ZERO ? pkg.count : 0);
          if (sendCount <= 0) {
            line.gift = '按配置跳过送礼';
            line.left = pkg.count;
          } else {
            const left = await sendTigerFood(meta.pid, pkg.itemType, sendCount);
            line.gift = '已送出 ' + sendCount + ' 个虎粮';
            line.left = left === null ? null : left;
          }
        }
      } catch (e) { line.gift = '失败: ' + e.message; }
      await sleep(300);

      // 4. 勋章（展示用）
      try {
        const badge = await queryBadge(meta.pid);
        if (badge) line.badge = badge.name + ' ' + badge.level + '级 (' + badge.current + '/' + badge.next + ')';
      } catch (e) { /* 忽略 */ }
    } catch (e) {
      line.daka = line.daka || '-';
      line.gift = '房间信息获取失败: ' + e.message;
    }
    lines.push(line);
    await sleep(500);
  }

  // 汇总通知
  const content = lines.map((l) => {
    let s = '【' + l.room + '】' + (l.nick || '');
    if (l.badge) s += '\n🏅 ' + l.badge;
    s += '\n🚩 打卡：' + l.daka;
    s += '\n🎁 福利：' + l.welfare;
    s += '\n🐯 送粮：' + l.gift + (l.left !== null && l.left !== undefined ? '（余 ' + l.left + '）' : '');
    return s;
  }).join('\n\n');
  $notify('🐯 虎牙每日助手', '已处理 ' + lines.length + ' 个房间', content);
  $done();
}

/* ---------- 测试钩子（仅 Node 调试用） ---------- */
function testBuildPackets(cookie, pid) {
  initUser(cookie);
  const hex = (u8) => Buffer ? Buffer.from(u8).toString('hex') : '';
  const seqSign = md5(utf8Encode(UID + '1' + FROM_TYPE + BUSINESS_TYPE + SEQUENCE_APP_KEY));
  return {
    fansSign: hex(buildWup('wupui', 'getFansSign', buildFansSignReq(pid))),
    welfare: hex(buildWup('wupui', 'queryFansGroupTaskInfo', buildWelfareReq(pid))),
    package: hex(buildWup('wupui', 'getPackageGift', buildPkgReq(pid))),
    seqSign: seqSign,
    uid: UID,
  };
}

/* ---------- 环境入口 ---------- */
if (typeof $task !== 'undefined' || typeof $persistentStore !== 'undefined' || typeof $notify !== 'undefined') {
  main();
} else if (typeof module !== 'undefined') {
  // Node 调试环境导出
  module.exports = {
    utf8Encode: utf8Encode, utf8Decode: utf8Decode,
    b64encode: b64encode, b64decode: b64decode,
    md5: md5, hex_md5: hex_md5,
    JceOutputStream: JceOutputStream, JceInputStream: JceInputStream,
    buildWup: buildWup, parseWupResponse: parseWupResponse,
    initUser: initUser,
    buildFansSignReq: buildFansSignReq,
    buildWelfareReq: buildWelfareReq,
    buildPkgReq: buildPkgReq,
    testBuildPackets: testBuildPackets,
    gunzip: gunzip,
  };
}
