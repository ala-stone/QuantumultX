// ============================================================
//  红果短剧 去广告 · Quantumult X 脚本
// ------------------------------------------------------------
//  作用：把穿山甲(Pangle) SDK 的广告拉取接口替换成空广告位，
//        可选清理红果自有 API 响应里的广告字段。
//
//  [rewrite_local]
//    ^https?:\/\/[^\/]+pangolin-sdk-toutiao[^\/]*\/api\/ad\/union\/sdk\/ url script-response-body https://raw.githubusercontent.com/ala-stone/QuantumultX/refs/heads/main/hongguo-ad.js
//
//  [mitm]
//    hostname = *.pangolin-sdk-toutiao.com, *.pangolin-sdk-toutiao-b.com, *.pangolin-sdk-toutiao1.com
//
//  说明：域名层拦截（filter_local 里的 reject）不需要本脚本，
//        本脚本只处理「必须解密后改写响应体」的那部分。
// ============================================================

const CONFIG = {
    // 穿山甲广告接口 → 返回空 JSON {}。
    // SDK 会把 {} 当成"本次无广告可用"，不会重试，也不会报网络错误。
    EMPTY_PANGOLIN: true,

    // 红果自有 API 响应里的广告字段清理（实验性，默认关闭）。
    // 开启前请先看 README「已知限制」：需要 MITM *.snssdk.com，
    // 该域含视频 CDN，字节 App 不认自签 CA，会导致 TLS 失败、拖慢播放。
    STRIP_HG_ADS: false,

    // 命中时打印日志，方便在 QX 的「日志/分析」里确认规则生效。
    DEBUG: true,

    // 额外打印被改写接口的顶层字段名（排查广告字段位置用，日志会变多）。
    DUMP_KEYS: false,
};

// 广告容器的字段名（命中即整块删除）。只列明确无歧义的，避免误删播放参数。
const AD_CONTAINER_KEYS = [
    "ad_info",
    "ad_data",
    "ad_raw_data",
    "ad_extra",
    "ad_log_extra",
    "ad_info_json",
    "ad_info_v2",
    "ad_info_new",
];

const PANGOLIN_HOST_RE = /pangolin-sdk-toutiao|pglstatp-toutiao/i;
const PANGOLIN_AD_PATH_RE = /\/api\/ad\/union\/sdk\//i;
const HG_API_HOST_RE = /(?:^|\.)(?:snssdk|fqnovel)\.com$/i;
const HG_AD_PATH_RE = /\/api\/ad\//i;

function log(msg) {
    if (CONFIG.DEBUG) console.log("[红果AD] " + msg);
}

function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

// 带正片身份的字段。一个节点只要还带这些中的任意一个，
// 就说明它是"某一集"，不能整条删掉——最多把它挂的广告字段剥掉，
// 否则会表现成"少了一集"。
const CONTENT_ID_KEYS = [
    "vid", "video_id", "series_id", "book_id", "chapter_id",
    "item_id", "episode_id", "chapter_index", "main_url", "video_model",
];

function hasContentIdentity(node) {
    for (let i = 0; i < CONTENT_ID_KEYS.length; i++) {
        if (Object.prototype.hasOwnProperty.call(node, CONTENT_ID_KEYS[i])) {
            const v = node[CONTENT_ID_KEYS[i]];
            if (v !== null && v !== "" && v !== undefined) return true;
        }
    }
    return false;
}

// 判断一个节点是不是"一整块纯广告"（可以安全地整条丢弃）
function isAdBlock(node) {
    if (!isPlainObject(node)) return false;
    if (hasContentIdentity(node)) return false;   // 是正片，不许删

    if (node.is_ad === 1 || node.is_ad === true) return true;
    if (node.has_ad === true) return true;
    if (typeof node.ad_type === "number" && node.ad_type > 0) return true;
    if (typeof node.ad_type === "string" && node.ad_type !== "" && node.ad_type !== "0") return true;
    if (node.ad_info) {
        if (isPlainObject(node.ad_info)) return Object.keys(node.ad_info).length > 0;
        if (Array.isArray(node.ad_info)) return node.ad_info.length > 0;
        return true;
    }
    return false;
}

// 递归清理：删广告块、清广告字段、翻转 has_ad / is_ad
function scrub(node, depth) {
    if (depth > 15 || node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
            const item = node[i];
            if (isAdBlock(item)) {
                node.splice(i, 1);
                continue;
            }
            scrub(item, depth + 1);
        }
        return;
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (AD_CONTAINER_KEYS.indexOf(k) !== -1) {
            delete node[k];
            continue;
        }
        scrub(node[k], depth + 1);
    }

    if (Object.prototype.hasOwnProperty.call(node, "has_ad")) node.has_ad = false;
    if (Object.prototype.hasOwnProperty.call(node, "is_ad")) node.is_ad = 0;
}

function main() {
    const url = ($request && $request.url) || "";
    log("hit " + url);

    // ── 1. 穿山甲广告接口：给一个空的合法响应 ──
    if (CONFIG.EMPTY_PANGOLIN && PANGOLIN_HOST_RE.test(url) && PANGOLIN_AD_PATH_RE.test(url)) {
        log("→ 穿山甲广告位置空 {}");
        $done({ body: "{}" });
        return;
    }

    // ── 2. 红果自有 API：清理广告字段（实验性） ──
    if (CONFIG.STRIP_HG_ADS && HG_API_HOST_RE.test(hostOf(url)) && HG_AD_PATH_RE.test(url)) {
        const body = $response && $response.body;
        if (!body) {
            $done({});
            return;
        }
        let json = null;
        try {
            json = JSON.parse(body);
        } catch (e) {
            // 不是 JSON（可能是 protobuf），原样放行
            log("→ 响应非 JSON，跳过");
            $done({});
            return;
        }
        if (CONFIG.DUMP_KEYS && isPlainObject(json)) {
            log("顶层字段: " + Object.keys(json).join(","));
        }
        scrub(json, 0);
        log("→ 已清理广告字段");
        $done({ body: JSON.stringify(json) });
        return;
    }

    // 不匹配任何规则：保持原响应
    $done({});
}

function hostOf(u) {
    const m = /^https?:\/\/([^\/:?#]+)/i.exec(u);
    return m ? m[1] : "";
}

try {
    main();
} catch (e) {
    log("脚本异常，放行原响应: " + e);
    $done({});
}
