// ==================================================
// TapTap 自动签到 + 领取礼包码脚本 v2.0
// 适配平台: Quantumult X (圈X)
// 脚本类型: task (定时任务)
//
// 【功能】
//   1. 执行签到（POST check_in）
//   2. 自动查询已领取列表，找出今日新可领取的那一档
//   3. 调用领取接口（POST check-in-accept-award）领取礼包码
//   4. 打印并通知所有已获得的兑换码
//
// 【依赖】
//   需先安装 taptap_cookie.js 重写插件，打开签到页触发一次 Cookie 抓取。
//
// 【圈X 定时任务配置】
//   [task_local]
//   ; 每天早上 8:30 执行（可自行修改时间）
//   30 8 * * * taptap_signin.js, tag=TapTap签到, img-url=https://www.taptap.cn/favicon.ico, enabled=true
//
// 【圈X 重写规则（配合 Cookie 插件）】
//   ^https?:\/\/www\.taptap\.cn\/webapiv2\/ url script-request-header taptap_cookie.js
//
// 【MitM 域名】
//   hostname = www.taptap.cn
// ==================================================

(function () {

  // ── 1. 从 $prefs 读取认证数据 ──
  const rawCookie  = $prefs.valueForKey("taptap_cookie")      || "";
  const xsrfToken  = $prefs.valueForKey("taptap_xsrf")        || "";
  const userId     = $prefs.valueForKey("taptap_user_id")     || "";
  const smfp       = $prefs.valueForKey("taptap_smfp")        || "";
  const uuid       = $prefs.valueForKey("taptap_uuid")        || "";
  const clientXua  = $prefs.valueForKey("taptap_client_xua")  || "";
  const activityId = $prefs.valueForKey("taptap_activity_id") || "wxmxb2il";

  // ── 2. 校验必要字段 ──
  if (!rawCookie || !xsrfToken) {
    const msg = "Cookie 未获取，请先用浏览器打开 TapTap 签到页触发抓取。";
    console.log("[TapTap] ❌ " + msg);
    $notify("TapTap 签到失败", "缺少认证信息", msg);
    $done();
    return;
  }

  // ── 3. 全部奖励档位（award_id 来自 detail 接口的 award_pool）──
  const ALL_AWARDS = [
    { day: 1,  award_id: 149341, content: "金龙*188"      },
    { day: 2,  award_id: 149342, content: "姑苏券*10"     },
    { day: 3,  award_id: 149343, content: "祈愿符*1"      },
    { day: 4,  award_id: 149344, content: "金龙*288"      },
    { day: 5,  award_id: 149345, content: "映朝花*1"      },
    { day: 6,  award_id: 149346, content: "新安当票*1"    },
    { day: 7,  award_id: 149347, content: "祈愿符*2"      },
    { day: 8,  award_id: 149348, content: "五系招募石*1"  },
    { day: 9,  award_id: 149349, content: "3星幻灵随机包*1"},
    { day: 10, award_id: 149350, content: "至尊召唤券*2"  },
  ];

  // ── 4. 构造请求头和 URL 辅助函数 ──
  function makeHeaders() {
    const h = {
      "Host":             "www.taptap.cn",
      "Content-Type":     "application/x-www-form-urlencoded",
      "Accept":           "application/json, text/plain, */*",
      "x-requested-with": "XMLHttpRequest",
      "X-XSRF-TOKEN":     xsrfToken,
      "Sec-Fetch-Site":   "same-origin",
      "Sec-Fetch-Mode":   "cors",
      "Sec-Fetch-Dest":   "empty",
      "Origin":           "https://www.taptap.cn",
      "Referer":          "https://www.taptap.cn/events/game-sign/" + activityId,
      "User-Agent":       "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      "Accept-Language":   "zh-CN,zh-Hans;q=0.9",
      "Cookie":           rawCookie,
    };
    if (clientXua) h["X-CLIENT-XUA"] = clientXua;
    if (smfp)      h["x-smfp"]       = smfp;
    return h;
  }

  function makeUA() {
    return "V%3D1%26PN%3DWebActivity%26LANG%3Dzh_CN%26LOC%3DCN%26PLT%3DiOS"
      + "%26UID%3D" + encodeURIComponent(uuid)
      + "%26VN_CODE%3D3"
      + "%26VID%3D" + encodeURIComponent(userId);
  }

  function buildQuery(url, extra) {
    return url + "?X-UA=" + makeUA() + (extra ? "&" + extra : "");
  }

  const headers = makeHeaders();

  // ── 5. 打印所有已获得兑换码（从已有列表）──
  function printAllCodes(codes) {
    console.log("[TapTap] ── 已获得兑换码 ──");
    if (codes.length === 0) {
      console.log("  (暂无兑换码)");
    } else {
      codes.forEach(function (item) {
        console.log("  " + item.title + "  →  " + item.code + "  (领于 " + item.time + ")");
      });
    }
    console.log("[TapTap] ────────────────────");
  }

  // ── 6. 发送最终通知 ──
  function sendNotify(title, sub, body, codes) {
    printAllCodes(codes);
    console.log("[TapTap] " + title + " | 已领 " + codes.length + "/10 档");
    $notify(title, sub, body);
    $done();
  }

  // ── 7. 查询已领取列表，并执行领取逻辑 ──
  function fetchAndClaim(isFirstSign) {
    const awardListUrl = buildQuery(
      "https://www.taptap.cn/webapiv2/event/game-sign/v2/my-award-list/" + activityId
    );

    $task.fetch({ url: awardListUrl, method: "GET", headers: headers }).then(
      function (resp) {
        let claimedCount = 0;
        let allCodes = [];

        try {
          const b = JSON.parse(resp.body);
          const list = b.data && b.data.award_list;
          if (list && list.length > 0) {
            list.forEach(function (item) {
              const title = (item.prize && item.prize.title) ? item.prize.title : "(未知)";
              allCodes.push({
                title: title,
                code:  item.code || "(无码)",
                time:  item.time ? new Date(item.time * 1000).toLocaleString("zh-CN") : "?",
              });
            });
          }
          claimedCount = list ? list.length : 0;
        } catch (e) {}

        // ── 找出下一档可领取的 award_id ──
        // 只有签到成功（首次签到）才尝试领取；已签到则不重复领
        if (isFirstSign && claimedCount < ALL_AWARDS.length) {
          const nextAward = ALL_AWARDS[claimedCount]; // 0-indexed，claimedCount 即下一档
          console.log("[TapTap] 尝试领取: 第" + nextAward.day + "天 " + nextAward.content + " (award_id=" + nextAward.award_id + ")");

          // ── 调用领取接口 ──
          const claimUrl = buildQuery(
            "https://www.taptap.cn/webapiv2/event/game-sign/v2/check-in-accept-award"
          );
          const claimBody = "award_id=" + nextAward.award_id
            + (smfp ? "&smfp=" + encodeURIComponent(smfp) : "");

          $task.fetch({
            url:     claimUrl,
            method:  "POST",
            headers: headers,
            body:    claimBody,
          }).then(
            function (resp3) {
              try {
                const r3 = JSON.parse(resp3.body);
                if (r3.success && r3.data && r3.data.code) {
                  const newCode = r3.data.code;
                  const newTitle = (r3.data.prize && r3.data.prize.title) ? r3.data.prize.title : nextAward.content;
                  const newTime  = r3.data.time ? new Date(r3.data.time * 1000).toLocaleString("zh-CN") : "刚刚";
                  // 将新码插入列表
                  allCodes.push({ title: newTitle, code: newCode, time: newTime });
                  console.log("[TapTap] ✅ 领取成功: " + newTitle + " → " + newCode);
                } else {
                  const errMsg = (r3.data && r3.data.msg) ? r3.data.msg : JSON.stringify(r3);
                  console.log("[TapTap] ⚠️ 领取失败: " + errMsg);
                }
              } catch (e) {
                console.log("[TapTap] ⚠️ 领取响应解析失败: " + resp3.body.substring(0, 100));
              }

              buildNotifyAndDone(true, claimedCount, allCodes);

            },
            function (err3) {
              console.log("[TapTap] ⚠️ 领取请求失败: " + err3.error);
              // 领取失败不影响整体结果
              buildNotifyAndDone(true, claimedCount, allCodes);
            }
          );

        } else {
          buildNotifyAndDone(false, claimedCount, allCodes);
        }

        function buildNotifyAndDone(newlySigned, claimed, codes) {
          const progressBar = ALL_AWARDS.map(function(a) {
            return a.day <= claimed ? "✅" : "⬜";
          }).join("");
          const nextA = ALL_AWARDS[claimed];
          const nextHint = newlySigned
            ? ("本次领取: " + (codes[codes.length-1] ? codes[codes.length-1].title : "?") + " → " + (codes[codes.length-1] ? codes[codes.length-1].code : "?"))
            : "";

          const titleText = newlySigned ? "TapTap ✅ 签到+领取成功" : "TapTap ℹ️ 今日已签到";
          const bodyText  = progressBar + "\n"
            + "已累计: " + claimed + "/10 天\n"
            + (nextA ? ("下一档: 第" + nextA.day + "天 → " + nextA.content) : "🎉 全部奖励已领取！")
            + (nextHint ? ("\n本次: " + codes[codes.length-1].code) : "");

          sendNotify(titleText, "活动: " + activityId + " | user: " + userId, bodyText, codes);
        }

      },
      function (err2) {
        console.log("[TapTap] ⚠️ 查询已领取列表失败: " + err2.error);
        const titleText = isFirstSign ? "TapTap ✅ 签到成功" : "TapTap ℹ️ 今日已签到";
        sendNotify(titleText, "活动: " + activityId + " | user: " + userId,
          "已签到成功，兑换码查询失败，请手动查看。", []);
      }
    );
  }

  // ── 8. 执行签到 ──
  const checkInUrl = buildQuery(
    "https://www.taptap.cn/webapiv2/event/game-sign/check_in"
  );
  const checkInBody = "activity_code=" + encodeURIComponent(activityId)
    + (smfp ? "&smfp=" + encodeURIComponent(smfp) : "");

  console.log("[TapTap] 开始签到  activity=" + activityId + "  user_id=" + userId);

  $task.fetch({
    url:    checkInUrl,
    method: "POST",
    headers: headers,
    body:   checkInBody,
  }).then(
    function (resp) {
      console.log("[TapTap] 签到 HTTP " + resp.statusCode);

      let result;
      try { result = JSON.parse(resp.body); } catch (e) { result = {}; }

      if (result.success) {
        console.log("[TapTap] ✅ 签到成功，开始领取礼包码...");
        fetchAndClaim(true);  // 首次签到，需要领取

      } else if (result.data && result.data.msg && result.data.msg.indexOf("已签到") !== -1) {
        console.log("[TapTap] ℹ️ 今日已签到，直接查询并领取（检查是否有新档可领）...");
        // 已签到时也尝试领取（防止之前漏领）
        fetchAndClaim(true);

      } else {
        const msg = (result.data && (result.data.msg || result.data.error_description))
                  ? result.data.msg || result.data.error_description
                  : JSON.stringify(result);
        console.log("[TapTap] ❌ 签到失败: " + msg);
        $notify("TapTap ❌ 签到失败", "HTTP " + resp.statusCode, msg);
        $done();
      }
    },
    function (err) {
      console.log("[TapTap] ❌ 网络请求失败: " + err.error);
      $notify("TapTap 签到失败", "网络错误", err.error || "请求超时");
      $done();
    }
  );

})();
