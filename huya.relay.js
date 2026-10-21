/**
 * 虎牙 WUP 二进制中转脚本 · Quantumult X
 *
 * [rewrite_local]
 * ^https?:\/\/wup\.huya\.com\/ url script-request-body huya.relay.js
 *
 * 原理：主任务脚本(huya.task.js)无法确定圈X能否直接发送二进制请求体，
 * 因此它把 WUP 二进制包 Base64 后作为请求体发出（带 X-HY-Relay: 1 标记头）；
 * 本脚本在圈X重写层将该 Base64 解码还原为真正的二进制 WUP 包，
 * 再交给虎牙 wup.huya.com 网关处理（响应二进制由主脚本 response.bodyBytes 读取）。
 *
 * 诊断：每次成功还原二进制时，会在持久化存储写入 HY_RELAY_LAST = 当前时间戳，
 *       并在圈X日志输出。主脚本可据此区分「中转未配置」与「中转已触发」。
 */

'use strict';

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

function markRelay() {
  try {
    if (typeof $prefs !== 'undefined' && $prefs.setValueForKey) { $prefs.setValueForKey(String(Date.now()), 'HY_RELAY_LAST'); return; }
  } catch (e) {}
  try {
    if (typeof $persistentStore !== 'undefined') $persistentStore.write(String(Date.now()), 'HY_RELAY_LAST');
  } catch (e) {}
}

(function () {
  try {
    const headers = ($request && $request.headers) || {};
    const marked = headers['X-HY-Relay'] === '1' || headers['x-hy-relay'] === '1';

    const body = ($request && $request.body) || '';
    // 非标记请求且 body 不是纯 base64（如虎牙 App 原生二进制流量）→ 原样放行
    if (!body || body.length < 16 || /[^A-Za-z0-9+\/=]/.test(body)) { $done({}); return; }

    const bytes = b64decode(body);
    if (!bytes.length) { $done({}); return; }

    markRelay();
    try { console.log('[虎牙中转] 已还原 WUP 二进制包 ' + bytes.length + ' 字节' + (marked ? '（标记请求）' : '')); } catch (e) {}
    $done({ bodyBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  } catch (e) {
    try { console.log('[虎牙中转] 异常: ' + e.message); } catch (e2) {}
    $done({});
  }
})();
