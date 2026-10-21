/**
 * 虎牙 Cookie 自动抓取脚本 · Quantumult X
 *
 * [rewrite_local]
 * ^https?:\/\/(?:[a-zA-Z0-9-]+\.)*huya\.com\/ url script-request-header huya.cookie.js
 *
 * 触发方式（任选其一）：
 * 1. 用 Safari 打开 https://i.huya.com 并登录
 * 2. 虎牙 App 内打开任意 H5 活动页（如粉丝团面板）
 *
 * 注意：圈X 持久化 API 是 $prefs（$persistentStore 是 Surge/Loon 的），
 *       这里做了双 API 兼容，且任何异常都不会阻断请求（保证 App 正常联网）。
 */

'use strict';

const COOKIE_KEY = 'HY_COOKIE_QX';

function storeRead(key) {
  try {
    if (typeof $prefs !== 'undefined' && $prefs.valueForKey) return $prefs.valueForKey(key) || '';
  } catch (e) {}
  try {
    if (typeof $persistentStore !== 'undefined') return $persistentStore.read(key) || '';
  } catch (e) {}
  return '';
}

function storeWrite(value, key) {
  try {
    if (typeof $prefs !== 'undefined' && $prefs.setValueForKey) { $prefs.setValueForKey(value, key); return true; }
  } catch (e) {}
  try {
    if (typeof $persistentStore !== 'undefined') { $persistentStore.write(value, key); return true; }
  } catch (e) {}
  return false;
}

(function () {
  try {
    const headers = ($request && $request.headers) || {};
    let cookie = headers['Cookie'] || headers['cookie'] || '';
    if (!cookie) return;

    // 仅保存包含登录凭证的 Cookie
    if (!/(yyuid|udb_uid)=\d+/.test(cookie) || cookie.indexOf('udb_biztoken=') === -1) return;

    const old = storeRead(COOKIE_KEY);
    if (cookie !== old) {
      const ok = storeWrite(cookie, COOKIE_KEY);
      if (ok) {
        const uid = (/(?:yyuid|udb_uid)=(\d+)/.exec(cookie) || [])[1] || '未知';
        try {
          $notify('🐯 虎牙助手', '✅ Cookie 获取成功', 'UID: ' + uid + '\n已自动保存，可直接运行打卡任务');
        } catch (e) {}
      }
    }
  } catch (e) {
    // 吞掉所有异常，保证请求正常放行
  } finally {
    try { $done({}); } catch (e) {}
  }
})();
