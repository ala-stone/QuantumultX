/**
 * ============================================================================
 *  小米众测 —— Cookie 自动捕获 (Quantumult X)
 *  类型: rewrite-request-header
 * ----------------------------------------------------------------------------
 *  作用:
 *    MiHome App / 网页版访问 home.mi.com 时, 自动把请求头里的 Cookie 与
 *    User-Agent 存入 $prefs, 供 MiTrial.js 使用, 免去手动粘贴抓包。
 *
 *  ⚠ 关键: 本脚本依赖圈X 的 MITM。只有被 MITM 解密过的 HTTPS 请求才会触发;
 *     没开 MITM、或 home.mi.com 不在 mitm hostname 里 => 永远不触发(这是
 *     "打开页面没捕获到 Cookie" 的最常见原因)。
 *
 *  圈X 配置(三处都要对):
 *    [mitm]
 *    hostname = home.mi.com, *.mi.com
 *
 *    [rewrite_local]
 *    ^https?://home\.mi\.com/ url script-request-header MiTrialCookie.js
 *
 *  ① 规则放宽到整个域名后, 打开活动页(HTML)即可触发, 不必等接口请求;
 *  ② 圈X 首页要把 "MitM" 总开关打开;
 *  ③ 系统 设置→通用→关于本机→证书信任设置 里要信任圈X 的证书。
 *
 *  验证: 打开活动页后, 在圈X 的日志里应能看到 [MiTrialCookie] 命中记录;
 *        首次成功捕获会推送一次通知。
 * ============================================================================
 */

const DEBUG = false; // true: 每次命中都推送通知, 便于排查是否触发

function getHeader(headers, name) {
  if (!headers) return "";
  const lower = name.toLowerCase();
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lower) return headers[keys[i]];
  }
  return "";
}

const headers = $request.headers || {};
const url = $request.url || "";
const cookie = getHeader(headers, "cookie");
const ua = getHeader(headers, "user-agent");

console.log("[MiTrialCookie] 命中 " + url + " | cookieLen=" + cookie.length);

function getCookieValue(cookieStr, name) {
  const m = cookieStr.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return m ? m[1] : "";
}

if (cookie && cookie.indexOf("serviceToken=") >= 0) {
  const old = $prefs.valueForKey("mi_trial_cookie") || "";
  // 用 serviceToken 判断是否同一登录态: 各接口 Cookie 字段顺序/细节会有差异,
  // 整串比较会导致反复"已更新"; token 相同 => 同一登录态, 直接跳过
  const newToken = getCookieValue(cookie, "serviceToken");
  const oldToken = getCookieValue(old, "serviceToken");
  if (newToken && newToken === oldToken) {
    // 同一登录态, 不重复写入, 只在 DEBUG 时提示
    if (DEBUG) console.log("[MiTrialCookie] serviceToken 未变化, 跳过保存");
  } else {
    $prefs.setValueForKey(cookie, "mi_trial_cookie");
    if (ua) $prefs.setValueForKey("mi_trial_ua", ua);
    // 首次捕获(或 DEBUG 模式)时推送一次, 之后静默
    if (DEBUG || old.indexOf("serviceToken=") < 0) {
      console.log("[MiTrialCookie] Cookie 已保存 (cookieLen=" + cookie.length + ")");
      $notify("小米众测", "已捕获登录 Cookie", "现在可以运行 MiTrial.js 了");
    } else {
      console.log("[MiTrialCookie] Cookie 已更新 (登录态变化, cookieLen=" + cookie.length + ")");
    }
  }
} else {
  console.log("[MiTrialCookie] 未发现 serviceToken, 可能未登录或无 Cookie");
}

$done({});
