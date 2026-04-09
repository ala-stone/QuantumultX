// ==================================================
// TapTap Cookie 自动获取插件 v1.1
// 适配平台: Quantumult X (圈X)
// 脚本类型: rewrite (HTTP请求重写 - 请求头拦截)
//
// 【功能】
//   拦截 TapTap 网页的 API 请求，自动提取并保存：
//   - Cookie (完整)
//   - XSRF-TOKEN
//   - User ID
//   - SMFP 指纹
//   - UUID
//   - X-CLIENT-XUA（iOS 客户端设备 UA，签到必需）
//   - Activity ID（签到活动ID，自动从 URL 提取）
//
// 【使用方法】
//   1. 在圈X「重写」中添加规则（或导入 taptap.conf 配置片段）
//   2. 开启「重写」和「MitM」开关，并信任证书
//   3. 用 Safari 或系统浏览器打开 TapTap 签到页：
//      https://www.taptap.cn/events/game-sign/
//   4. 插件自动捕获并保存 Cookie，通知提示「抓取成功」
//   5. 之后定时任务签到脚本会自动读取保存好的 Cookie
//
// 【圈X 重写规则】
//   ^https?:\/\/www\.taptap\.cn\/webapiv2\/ url script-request-header taptap_cookie.js
//
// 【MitM 域名】
//   hostname = www.taptap.cn
// ==================================================

(function() {
  // ── 只在请求头拦截模式下执行 ──
  if (typeof $request === "undefined") {
    $done({});
    return;
  }

  const url     = $request.url     || "";
  const headers = $request.headers || {};

  // ── 1. 提取 Cookie ──
  const rawCookie = headers["Cookie"] || headers["cookie"] || "";
  if (!rawCookie) {
    $done({});
    return;
  }

  // ── 2. 从 Cookie 字符串中解析各字段 ──
  function getCookieVal(name) {
    const match = rawCookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  const xsrfToken  = headers["X-XSRF-TOKEN"] || headers["x-xsrf-token"] || getCookieVal("XSRF-TOKEN");
  const smfp       = headers["x-smfp"]        || headers["X-SMFP"]       || "";
  const clientXua  = headers["X-CLIENT-XUA"]  || headers["x-client-xua"] || "";
  const userId     = getCookieVal("user_id");
  const uuid       = getCookieVal("web_app_uuid");

  // ── 3. 从 URL 提取 Activity ID ──
  // 精确匹配活动页 URL，防止任务脚本的 HTTP 请求被错误拦截
  // 匹配模式:
  //   /events/game-sign/wxmxb2il       → 捕获 wxmxb2il
  //   /game-sign/detail/wxmxb2il       → 捕获 wxmxb2il
  //   /game-sign/v2/my-award-list/XXX  → 不捕获（避免误拦截 task 请求）
  //   /webapiv2/...?X-UA=...           → 不捕获
  let activityId = "";
  // 优先匹配 /events/game-sign/{id}（活动页直接形式）
  let actMatch = url.match(/\/events\/game-sign\/([a-z0-9]+)(?:\?|\/|$)/i);
  if (!actMatch) {
    // 其次匹配 /game-sign/detail/{id}（详情接口形式）
    actMatch = url.match(/\/game-sign\/detail\/([a-z0-9]+)(?:\?|\/|$)/i);
  }
  if (actMatch) {
    activityId = actMatch[1];
  }

  // ── 4. 读取已存储的数据，判断是否需要更新 ──
  const oldCookie = $prefs.valueForKey("taptap_cookie") || "";

  // Cookie 没变化 且 非关键路径 且 无新 clientXua → 跳过（避免频繁写入）
  if (oldCookie === rawCookie && !activityId && !clientXua) {
    $done({});
    return;
  }

  // ── 5. 持久化保存 ──
  $prefs.setValueForKey(rawCookie,  "taptap_cookie");

  if (xsrfToken)  $prefs.setValueForKey(xsrfToken,  "taptap_xsrf");
  if (userId)     $prefs.setValueForKey(userId,      "taptap_user_id");
  if (smfp)       $prefs.setValueForKey(smfp,        "taptap_smfp");
  if (uuid)       $prefs.setValueForKey(uuid,        "taptap_uuid");
  if (activityId) $prefs.setValueForKey(activityId,  "taptap_activity_id");
  if (clientXua)  $prefs.setValueForKey(clientXua,   "taptap_client_xua");

  // ── 6. 通知用户（仅在 Cookie 更新时推送一次）──
  if (oldCookie !== rawCookie) {
    const uid     = userId     || $prefs.valueForKey("taptap_user_id") || "未知";
    const actId   = activityId || $prefs.valueForKey("taptap_activity_id") || "未知";
    const xsrf    = xsrfToken  || $prefs.valueForKey("taptap_xsrf")        || "未获取";
    const xuaStr  = clientXua  ? "✅" : "❌未捕获";

    console.log(`[TapTap Cookie] 已更新  user_id=${uid}  activity=${actId}  client_xua=${xuaStr}`);

    $notify(
      "TapTap 🍪 Cookie 已更新",
      `user_id: ${uid}  |  活动: ${actId}`,
      `XSRF: ${xsrf.substring(0, 12)}...  CLIENT-XUA: ${xuaStr}`
    );
  }

  // ── 放行原始请求，不做修改 ──
  $done({});
})();
