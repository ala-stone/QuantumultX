// ==================================================
// TapTap Cookie 自动获取插件 v2.0
// 适配平台: Quantumult X (圈X)
// 脚本类型: rewrite (HTTP请求重写)
//
// 【功能】
//   拦截 TapTap 网页的 API 请求/响应，自动提取并保存：
//   - Cookie (完整)
//   - XSRF-TOKEN
//   - User ID
//   - SMFP 指纹
//   - UUID
//   - X-CLIENT-XUA（iOS 客户端设备 UA，签到必需）
//   - Activity ID（签到活动ID，自动从 URL 提取）
//   - Award List（全部奖励档位 award_id 列表，从 detail 响应自动提取）
//
// 【使用方法】
//   1. 在圈X「重写」中添加规则（或导入 taptap.conf 配置片段）
//   2. 开启「重写」和「MitM」开关，并信任证书
//   3. 用 Safari 或系统浏览器打开 TapTap 签到页：
//      https://www.taptap.cn/events/game-sign/
//   4. 插件自动捕获 Cookie + 奖励档位，通知提示「抓取成功」
//   5. 之后定时任务签到脚本会自动读取保存好的数据
//
// 【圈X 重写规则（需要两条）】
//   ; 规则1: 请求头拦截 → 抓 Cookie/Activity ID/XUA
//   ^https?:\/\/www\.taptap\.cn\/webapiv2\/ url script-request-header taptap_cookie.js
//   ; 规则2: 响应体拦截 → 抓 award_id 列表
//   ^https?:\/\/www\.taptap\.cn\/webapiv2\/event\/game-sign\/detail\/ url script-response-body taptap_cookie.js
//
// 【MitM 域名】
//   hostname = www.taptap.cn
// ==================================================

(function() {
  // ═══════════════════════════════════════════════════
  // 模式1: 响应体拦截 (script-response-body)
  // 拦截 detail 接口响应，提取全部 award_id
  // ═══════════════════════════════════════════════════
  if (typeof $response !== "undefined") {
    const respUrl = ($request && $request.url) || "";

    // 仅处理 detail 接口的响应
    if (respUrl.indexOf("/game-sign/detail/") !== -1) {
      try {
        const body = JSON.parse($response.body);
        const awardList = body.data
          && body.data.award_pool
          && body.data.award_pool.award_list;

        if (awardList && awardList.length > 0) {
          // 提取每档的 day / award_id / content
          const awards = awardList.map(function(item) {
            return {
              day:      item.accept_threshold || 0,
              award_id: item.award_id,
              content:  item.content || item.label || ""
            };
          }).sort(function(a, b) { return a.day - b.day; });

          $prefs.setValueForKey(JSON.stringify(awards), "taptap_awards");

          // 同时从 detail 响应中提取 activity_id（作为备用途径）
          const actMatch = respUrl.match(/\/game-sign\/detail\/([a-z0-9]+)/i);
          if (actMatch) {
            $prefs.setValueForKey(actMatch[1], "taptap_activity_id");
          }

          const summary = awards.map(function(a) {
            return "第" + a.day + "天 " + a.content + " (id=" + a.award_id + ")";
          }).join("\n");

          console.log("[TapTap Cookie] 已抓取 " + awards.length + " 档奖励档位:\n" + summary);
          $notify(
            "TapTap 🎁 奖励档位已抓取",
            "共 " + awards.length + " 档",
            summary
          );
        }
      } catch(e) {
        console.log("[TapTap Cookie] 解析奖励档位失败: " + e);
      }
    }

    // 放行原始响应，不做修改
    $done({});
    return;
  }

  // ═══════════════════════════════════════════════════
  // 模式2: 请求头拦截 (script-request-header)
  // 抓 Cookie / XSRF / User ID / SMFP / UUID / XUA / Activity ID
  // ═══════════════════════════════════════════════════
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
