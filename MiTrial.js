/**
 * ============================================================================
 *  小米众测 / 米家试用 —— 自动获取活动 + 自动申请 + 提升中奖倍率
 *  平台: Quantumult X (cron 定时任务)
 *  作者: cgm
 * ----------------------------------------------------------------------------
 *  功能:
 *    1) 自动拉取"报名中"的众测活动 (list -> data.participating, activityStatus==1)
 *    2) 自动提交申请 (participation)
 *    3) 已申请的活动自动跳过 (userStatus.applyStatus >= 1)
 *    4) 自动完成任务提升中奖倍率 (progress -> completeMission)
 *       - "查看产品详情"(type=1): 先访问一次商品链接(模拟浏览), 再上报
 *       - 其余任务(type=2/3 等): 直接上报
 *    5) 往期活动自动开奖 (list.previous -> reveal-trial), 并读取是否中奖
 *       实测(2026-10-16 抓包): 已申请的活动 userStatus.applyStatus=0,
 *       未申请且已结束的活动 applyStatus=-1; 开奖只针对"已申请且未揭晓(reveal==0)"
 *       的活动, 并按申请截止时间降序(日期最近的优先, 如米家三筒洗衣机)。
 *    6) 查询"我的奖品" (/auth/trialActivity/v4/prize), 中奖则提示去填收货地址
 *    7) 汇总结果推送通知
 *    8) 众测预告 (list -> data.advance): 展示"尚未开始报名"的活动及报名开始时间
 *       实测(2026-10-17 抓包): advance 项结构与 participating 相同,
 *       activityStatus==0, 关键字段 advanceStartTime/advanceEndTime(预告展示期)、
 *       applyStartTime(报名开始)、applyEndTime(报名截止)。
 *       如: 米家扫拖机器人 7 Max 水箱版, 预告期 10-12 16:00 ~ 10-19 09:59,
 *           10-19 10:00 开始报名, 10-26 09:59 截止。
 *       报名开始后该活动会进入 participating(activityStatus==1), 由脚本自动申请,
 *       因此预告只需在通知里展示, 无需提前请求。
 *
 *  接口 (抓包自 MiHome App, 2026-10, BASE=/cgi-op/api/v1):
 *    GET  /trialActivity/v4/list                             活动列表(public)
 *         data: {previous: 往期, participating: 报名中, advance: 众测预告}
 *    GET  /trialActivity/v4/detail?activityId=x              活动详情(public)
 *    GET  /auth/trialActivity/v4/userStatus?activityId=x     用户申请状态(需登录)
 *         data.applyStatus: 已申请=0(含已结束待开奖), 未申请且已结束=-1,
 *                           报名中未申请=0 (该字段无法单独区分"报名中未申请")
 *         data.reveal: 0=未开奖, 1=已开奖
 *    GET  /auth/trialActivity/v4/prize                       我的奖品(需登录)
 *         data.list: 中奖记录数组, 空数组=暂无中奖; 有记录=中奖, 实物需填地址
 *    POST /auth/trialActivity/v4/participation               提交申请(需登录)
 *         body: {"activityId": 123}   code==0 成功 / 20029 已参与
 *    GET  /auth/trialActivity/v4/progress?activityId=x       任务进度(需登录)
 *         data: {currentMultiple, maxMultiple, tasks:[{type,taskId,multiple,accomplish,...}]}
 *    POST /auth/trialActivity/v4/completeMission             上报完成任务(需登录)
 *         body: {"activityId":123, "missionType":type, "taskId":taskId}
 *         missionType 即 progress.tasks[].type, 前端点击任务时就是这么传的
 *
 *  配置:
 *    [开箱即用] 直接把抓包 Cookie 填到下面 FALLBACK_COOKIE
 *    [更省心]   用同目录 MiTrialCookie.js + 圈X rewrite 自动捕获 Cookie
 *               (捕获后写入 $prefs["mi_trial_cookie"], 脚本自动优先使用)
 *
 *  圈X [task_local] 定时配置示例:
 *    0 8,20 * * * MiTrial.js, tag=小米众测自动申请, enabled=true
 *    (众测为"报名→开奖"抽奖制, 不是先到先得, 每天跑 1~2 次即可)
 *
 *  注意: 完成任务属模拟上报, 服务端对"绑定设备/邀请家人"等真实条件任务
 *        仍会校验, 条件不满足时会返回失败(属正常现象, 脚本会如实记录)。
 * ============================================================================
 */

// ------------------------------- 配置区 -------------------------------------
const COOKIE_KEY = "mi_trial_cookie";
const UA_KEY = "mi_trial_ua";

// 抓包得到的 Cookie。Cookie 会过期, 失效后请重新抓包替换, 或用 MiTrialCookie.js 自动更新
const FALLBACK_COOKIE = `locale=zh_CN; serviceToken=l6DWyWGxzZrDGhbxu7jHqGlGshjMIfMcoSVfFg602TSHmbqvzcQ26ZeSifLFVv/46kLt9/sURiNGOfH8NpQytmAgINJB98O+DXaGmi+cYRl6L+7+o/GxtBnosvm2jCwOKK2lZPCB2wrxH1oH1l7i3SXHl9IgJc/UusUVJySgkOg=; userId=2285060993; yetAnotherServiceToken=l6DWyWGxzZrDGhbxu7jHqGlGshjMIfMcoSVfFg602TSHmbqvzcQ26ZeSifLFVv/46kLt9/sURiNGOfH8NpQytmAgINJB98O+DXaGmi+cYRl6L+7+o/GxtBnosvm2jCwOKK2lZPCB2wrxH1oH1l7i3SXHl9IgJc/UusUVJySgkOg=; cUserId=YBvZQPeLC-7-0fA0dJK4Ogu07jg; deviceId=7A364B63EE636152; region=CN; countryCode=CN`;

const DEFAULT_UA = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) iOS/27.0.1 MiHome/11.7.203 iPhone/iPhone14,5 DeviceId/520B88562F7C07616E7119EDB7E81824CD0E56A3 UserId/2285060993 APP/com.xiaomi.mihome APPV/11.7.203 Platform/iPhone Region/CN `;

const OPERATE_COMMON = `_region=CN&_platformVersion=27.0.1&_deviceId=520B88562F7C07616E7119EDB7E81824CD0E56A3&_miui=0&_platform=1&_language=ZH_CN&_appVersion=11.7.203&_versionCode=`;

const BASE = "https://home.mi.com/cgi-op/api/v1";

const CONFIG = {
  // 额外强制申请的活动ID(即使没出现在列表里)。例如 [1571633033]
  extraActivityIds: [],
  // 已申请则跳过(不禁用; 已申请的活动仍会执行"提升倍率")
  skipApplied: true,
  // 自动完成任务提升中奖倍率
  boostMultiple: true,
  // "查看产品详情"任务(type=1)上报前, 先访问一次商品链接(模拟浏览行为)
  visitProductLink: true,
  // 往期活动自动开奖(揭晓抽奖结果)
  revealPrevious: true,
  // 查询"我的奖品": 有中奖记录时单独推送, 提示去 App 填收货地址
  checkPrize: true,
  // 展示众测预告(list.advance 中尚未开始报名的活动, 含报名开始时间)
  showAdvance: true,
  // 每次请求间隔(ms), 防止触发风控
  delayMs: 1200,
  // 没有可申请活动时是否也推送通知
  notifyWhenEmpty: false,
};

// 任务类型 -> 中文名
const MISSION_LABEL = { 1: "查看产品详情", 2: "绑定设备", 3: "邀请家人" };

// ------------------------------- 工具函数 -----------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 通知包装: $notify 在环境不支持/系统未授权时会静默失效, 这里加 try 并打日志,
// 便于从日志判断"脚本没推" 还是 "推了但系统没显示"
function notifySafe(title, sub, body) {
  try {
    if (typeof $notify === "undefined") {
      console.log("[MiTrial] 当前环境不支持 $notify");
      return false;
    }
    $notify(title, sub, body);
    console.log("[MiTrial] 已推送通知: " + title + " | " + sub);
    return true;
  } catch (e) {
    console.log("[MiTrial] 推送通知失败: " + e);
    return false;
  }
}

function getCookie() {
  return $prefs.valueForKey(COOKIE_KEY) || FALLBACK_COOKIE;
}

function getUA() {
  return $prefs.valueForKey(UA_KEY) || DEFAULT_UA;
}

function buildHeaders(referer) {
  return {
    Cookie: getCookie(),
    "User-Agent": getUA(),
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    "operate-common": OPERATE_COMMON,
    Referer: referer || "https://home.mi.com/",
    Connection: "keep-alive",
  };
}

// 统一请求, 返回解析后的 JSON; 异常时返回带负 code 的对象
function reqJson(method, url, body, referer) {
  const opt = { url: url, method: method, headers: buildHeaders(referer) };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  return $task
    .fetch(opt)
    .then((resp) => {
      try {
        return JSON.parse(resp.body);
      } catch (e) {
        return { code: -1, description: "解析失败: " + String(resp.body).slice(0, 120) };
      }
    })
    .catch((err) => ({
      code: -2,
      description: "网络错误: " + (err && err.error ? err.error : String(err)),
    }));
}

// 发起一次"浏览"型 GET 请求(不解析内容), 用于模拟打开商品页
function httpGetRaw(url, referer) {
  return $task
    .fetch({ url: url, method: "GET", headers: buildHeaders(referer) })
    .then(() => true)
    .catch(() => false);
}

function pickActivity(a) {
  const pd = a.productDetail || {};
  return {
    id: a.activityId,
    name: pd.productName || "活动" + a.activityId,
    end: a.applyEndTime || 0,
  };
}

// 时间戳 -> "MM-DD HH:mm"
function fmtTime(ts) {
  if (!ts) return "时间未知";
  const d = new Date(ts);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes())
  );
}

// 众测预告: 尚未开始报名的活动(applyStartTime 在未来)
function pickAdvance(a) {
  const pd = a.productDetail || {};
  return {
    id: a.activityId,
    name: pd.productName || "活动" + a.activityId,
    desc: pd.productDesc || "",
    applyStart: a.applyStartTime || 0,
    applyEnd: a.applyEndTime || 0,
  };
}

// 拉取任务进度
function getProgress(id, referer) {
  return reqJson(
    "GET",
    BASE + "/auth/trialActivity/v4/progress?activityId=" + id,
    undefined,
    referer
  );
}

// 上报完成任务
function completeMission(id, missionType, taskId, referer) {
  return reqJson(
    "POST",
    BASE + "/auth/trialActivity/v4/completeMission",
    { activityId: id, missionType: missionType, taskId: taskId },
    referer
  );
}

// 完成单个任务: type=1 "查看产品详情" 先访问商品链接, 再上报
async function completeTask(id, task, referer) {
  if (CONFIG.visitProductLink && task.type === 1 && task.productLink) {
    await httpGetRaw(task.productLink, referer);
    await sleep(600);
  }
  return completeMission(id, task.type, task.taskId, referer);
}

// 查询用户在指定活动的状态(applyStatus / reveal / 中奖字段)
function getUserStatus(id, referer) {
  return reqJson(
    "GET",
    BASE + "/auth/trialActivity/v4/userStatus?activityId=" + id,
    undefined,
    referer
  );
}

// 开奖(揭晓抽奖结果); code==0 表示成功
function revealTrial(id, referer) {
  return reqJson(
    "POST",
    BASE + "/auth/trialActivity/v4/reveal-trial",
    { activityId: id },
    referer
  );
}

// 查询"我的奖品"(我的众测 -> 我的奖品 页面用的接口)
function getPrizes(referer) {
  return reqJson("GET", BASE + "/auth/trialActivity/v4/prize", undefined, referer);
}

// 从奖品记录里尽量提取可读信息。
// 注: 抓包时奖品列表为空(data.list=[]), 中奖记录的具体字段无法确认,
//     这里对多个可能的字段名做兼容, 并保留原始记录以便排查。
function describePrize(item) {
  if (!item || typeof item !== "object") return "";
  const pd = item.productDetail || {};
  const name =
    item.prizeName ||
    item.productName ||
    item.name ||
    pd.productName ||
    item.productPrompt ||
    (item.activityId ? "活动" + item.activityId : "") ||
    "未知奖品";
  // 尽量区分实物/虚拟: 实物(需填地址)通常带 validate/收货 相关字段
  const physical =
    item.productValidateStartTime > 0 ||
    item.productValidateEndTime > 0 ||
    item.needAddress === true ||
    (!item.virtualPrize && pd.productName);
  const extra = item.prompt || item.prizePrompt || "";
  return name + (extra ? "(" + extra + ")" : "") + (physical ? "[实物]" : "");
}

// 根据 userStatus 判断中奖结果
function judgePrize(d) {
  if (!d) return "结果未知";
  // 实物奖品: productValidate* 有效
  if (d.productValidateStartTime > 0 || d.productValidateEndTime > 0) {
    return "中奖(实物)";
  }
  // 虚拟奖品
  if (d.virtualPrize) {
    const p = d.virtualPrize.prompt || d.virtualPrize.prizeName || "";
    return "中奖(虚拟奖品" + (p ? "：" + p : "") + ")";
  }
  return "未中奖";
}

// 提升中奖倍率: 对未完成任务逐个上报, 返回一句摘要
async function boostMultiple(id, referer) {
  const pg = await getProgress(id, referer);
  if (!pg || pg.code !== 0 || !pg.data) {
    return "倍率获取失败(" + (pg ? pg.description || pg.code : "无响应") + ")";
  }

  const before = pg.data.currentMultiple;
  const max = pg.data.maxMultiple;
  const tasks = pg.data.tasks || [];
  const todo = tasks.filter((t) => t && !t.accomplish);

  if (todo.length === 0) {
    return "倍率 " + before + "/" + max + " (任务已全部完成)";
  }

  let doneOk = 0;
  for (const t of todo) {
    const label = t.title || MISSION_LABEL[t.type] || "任务" + t.type;
    const cr = await completeTask(id, t, referer);
    if (cr && cr.code === 0) doneOk++;
    console.log(
      "[MiTrial] 任务「" +
        label +
        "」(type=" +
        t.type +
        ") -> " +
        (cr ? "code=" + cr.code : "无响应")
    );
    await sleep(CONFIG.delayMs);
  }

  // 复查最新倍率
  const pg2 = await getProgress(id, referer);
  const after = pg2 && pg2.data ? pg2.data.currentMultiple : before;
  const mx2 = pg2 && pg2.data ? pg2.data.maxMultiple : max;
  return "倍率 " + after + "/" + mx2 + " (待完成" + todo.length + ", 上报成功" + doneOk + ")";
}

// ------------------------------- 主流程 -------------------------------------
(async () => {
  const title = "小米众测自动申请";
  console.log("[MiTrial] 开始执行");

  // 1) 拉取活动列表
  const listResp = await reqJson("GET", BASE + "/trialActivity/v4/list");
  const candidates = [];
  const seen = {};

  if (listResp && listResp.code === 0 && listResp.data) {
    const part = listResp.data.participating || [];
    part.forEach((a) => {
      if (a && a.activityStatus === 1 && !seen[a.activityId]) {
        seen[a.activityId] = 1;
        candidates.push(pickActivity(a));
      }
    });
  } else {
    const desc = listResp ? listResp.description || listResp.code : "无响应";
    console.log("[MiTrial] 列表获取失败: " + desc);
    if (CONFIG.extraActivityIds.length === 0) {
      notifySafe(title, "列表获取失败", String(desc));
      return $done();
    }
  }

  // 合并手动指定的活动ID
  CONFIG.extraActivityIds.forEach((id) => {
    if (!seen[id]) {
      seen[id] = 1;
      candidates.push({ id: id, name: "活动" + id, end: 0 });
    }
  });

  // 收集众测预告(尚未开始报名的活动)
  const previews = [];
  if (CONFIG.showAdvance && listResp && listResp.code === 0 && listResp.data) {
    (listResp.data.advance || []).forEach((a) => {
      if (a && a.activityId && (a.applyStartTime || 0) > Date.now()) {
        previews.push(pickAdvance(a));
      }
    });
    // 按报名开始时间升序: 最先开抢的排前面
    previews.sort((x, y) => x.applyStart - y.applyStart);
  }
  const previewLines = previews.map(
    (p) => "【预告】" + p.name + " → " + fmtTime(p.applyStart) + " 开始报名"
  );

  if (candidates.length === 0) {
    console.log("[MiTrial] 当前没有报名中的活动");
    if (previews.length > 0) {
      console.log("[MiTrial] 有 " + previews.length + " 个众测预告");
      notifySafe(
        title,
        "没有报名中的活动，有 " + previews.length + " 个预告",
        previewLines.join("\n")
      );
    } else if (CONFIG.notifyWhenEmpty) {
      notifySafe(title, "没有报名中的活动", "");
    }
    return $done();
  }

  // 2) 逐个处理: 申请 -> 提升倍率
  const results = [];
  let ok = 0,
    skip = 0,
    fail = 0,
    win = 0;

  for (const act of candidates) {
    const id = act.id;
    const name = act.name;
    const referer =
      "https://home.mi.com/webapp/trial/detail/index.html?id=" +
      id +
      "&fullscreen=1&participate=1";
    const notes = [];
    let applied = false;

    // --- 阶段 1: 申请 ---
    if (CONFIG.skipApplied) {
      const st = await reqJson(
        "GET",
        BASE + "/auth/trialActivity/v4/userStatus?activityId=" + id,
        undefined,
        referer
      );
      const applyStatus = st && st.data ? st.data.applyStatus : undefined;
      if (typeof applyStatus === "number" && applyStatus >= 1) {
        applied = true;
        notes.push("已申请");
        skip++;
      }
    }

    if (!applied) {
      const r = await reqJson(
        "POST",
        BASE + "/auth/trialActivity/v4/participation",
        { activityId: id },
        referer
      );
      if (r && r.code === 0) {
        applied = true;
        notes.push("申请成功");
        ok++;
      } else if (r && r.code === 20029) {
        applied = true;
        notes.push("已参与");
        skip++;
      } else {
        const d = r ? r.description || r.message || "code=" + r.code : "无响应";
        notes.push("申请失败(" + d + ")");
        fail++;
      }
      await sleep(CONFIG.delayMs);
    }

    // --- 阶段 2: 提升中奖倍率 ---
    if (CONFIG.boostMultiple && applied) {
      const boost = await boostMultiple(id, referer);
      notes.push(boost);
    }

    results.push("【" + name + "】" + notes.join("，"));
  }

  // 3) 往期活动开奖
  //    可开奖 = 我已申请 且 未揭晓(userStatus.reveal===0)
  //    实测(2026-10-16 抓包): 已申请(含已结束待开奖)的 applyStatus=0,
  //    未申请且已结束的 applyStatus=-1 (如未参与的摄像机)。
  //    旧逻辑 "!d.applyStatus"(要求>=1)会把真正待开奖的活动跳过,
  //    反而去开奖了没参与的活动 —— 已修正为 applyStatus<0 视为未参与。
  //    按 applyEndTime 降序排列, 日期最近的活动优先开奖。
  if (CONFIG.revealPrevious && listResp && listResp.code === 0 && listResp.data) {
    const prev = (listResp.data.previous || [])
      .slice()
      .sort((a, b) => (b.applyEndTime || 0) - (a.applyEndTime || 0));
    for (const a of prev) {
      const pid = a.activityId;
      if (!pid) continue;
      const pname = (a.productDetail || {}).productName || "活动" + pid;
      const prefe =
        "https://home.mi.com/webapp/trial/detail/index.html?id=" +
        pid +
        "&fullscreen=1&participate=1";

      const us = await getUserStatus(pid, prefe);
      const d = us ? us.data : null;
      // 已揭晓(reveal!=0) => 跳过; 未申请且已结束(applyStatus<0) => 跳过
      if (!d || d.reveal !== 0) continue;
      if (typeof d.applyStatus === "number" && d.applyStatus < 0) continue;

      const rr = await revealTrial(pid, prefe);
      if (rr && rr.code === 0) {
        const us2 = await getUserStatus(pid, prefe);
        let res = judgePrize(us2 ? us2.data : null);
        // 实物中奖需要填收货地址, 直接在通知里提醒
        if (res.indexOf("中奖(实物)") >= 0) {
          res += "，🎁 请打开米家App→我的众测→我的奖品 填写收货地址";
        }
        results.push("【开奖】" + pname + " → " + res);
        if (res.indexOf("中奖") >= 0) win++;
      } else {
        results.push("【开奖】" + pname + " → 失败(" + (rr ? rr.code : "无响应") + ")");
      }
      await sleep(CONFIG.delayMs);
    }
  }

  // 4) 查询"我的奖品" (含历史中奖记录; 往期开奖后奖品会出现在这里)
  let prizeNotes = [];
  if (CONFIG.checkPrize) {
    const pz = await getPrizes();
    if (pz && pz.code === 0 && pz.data) {
      const list = pz.data.list || [];
      if (list.length > 0) {
        win += list.length;
        prizeNotes.push("🎁 中奖啦! 共 " + list.length + " 个奖品:");
        list.forEach((item, i) => {
          const desc = describePrize(item);
          prizeNotes.push("  " + (i + 1) + ". " + (desc || JSON.stringify(item).slice(0, 80)));
        });
        prizeNotes.push("→ 请打开米家App→我的众测→我的奖品 填写收货地址");
        console.log("[MiTrial] 奖品记录: " + JSON.stringify(list));
      } else {
        console.log("[MiTrial] 我的奖品: 暂无中奖记录");
      }
    } else {
      console.log(
        "[MiTrial] 奖品查询失败: " + (pz ? pz.description || pz.code : "无响应")
      );
    }
  }

  // 5) 通知 (预告放最后展示, 开始报名后下一次运行会自动申请)
  let previewNotes = [];
  if (previews.length > 0) {
    previewNotes.push("📋 众测预告(开始报名后自动申请):");
    previews.forEach((p) => {
      previewNotes.push(
        "  " + p.name + " | " + fmtTime(p.applyStart) + " 开抢" +
        (p.applyEnd ? "，" + fmtTime(p.applyEnd) + " 截止" : "")
      );
    });
  }
  const bodyStr = results.concat(prizeNotes, previewNotes).join("\n");
  notifySafe(
    title,
    "成功" + ok + " 跳过" + skip + " 失败" + fail + (win ? " 中奖" + win : "") +
      (previews.length ? " 预告" + previews.length : ""),
    bodyStr
  );
  console.log("[MiTrial] 完成\n" + bodyStr);
  $done();
})();
