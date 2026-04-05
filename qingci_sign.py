#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
青瓷游戏 - 仙剑签到自动脚本
目标页面: https://h5.qingcigame.com/package/template/enterb59uwn8hdzo?app_id=58

【重要说明】本签到系统强依赖微信 OAuth Session，有两种运行模式：

模式A - 手机号登录（默认）:
  填写 ACCOUNT + PASSWORD。但此账号必须先在微信内打开过签到页完成授权。
  如果签到一直报500/user_id为null，请改用模式B。

模式B - 直接使用微信Cookie（推荐/可靠）:
  1. 用手机微信打开: https://h5.qingcigame.com/package/template/enterb59uwn8hdzo?app_id=58
  2. 用抓包工具（Charles/mitmproxy/Stream）抓取任意一个 api.qingcigame.com 请求
  3. 复制其中的 PHPSESSID 和 aliyungf_tc 两个 Cookie 值填入下方
  Cookie 有效期约2小时，每次运行前需要从微信重新获取。
  如果觉得每次都要抓包太麻烦，建议只做一次「路A」的微信OAuth授权，
  之后就可以永久使用模式A（手机号登录）。
"""

import requests
import sys
import getpass
from datetime import datetime


# ────────────────────────────────────────────────
#  喵提醒推送配置（仅在签到未成功时触发）
# ────────────────────────────────────────────────
# 在 http://miaotixing.com 创建触发器后，复制完整 URL 填入下方
# 格式示例: "http://miaotixing.com/trigger?id=t8KejPC"
MIAOTIXING_URL = "http://miaotixing.com/trigger?id=t8KejPC"   # ← 填入你的喵提醒 URL


# ────────────────────────────────────────────────
#  通知函数（仅在签到未成功时调用）
# ────────────────────────────────────────────────
def send_notify(title: str, message: str):
    """
    通过喵提醒发送微信通知。
    需在上方 MIAOTIXING_URL 填入你的触发器 URL。
    URL 为空时跳过通知，不报错。
    """
    if not MIAOTIXING_URL.strip():
        print("      [通知] MIAOTIXING_URL 未配置，跳过推送")
        return

    import urllib.parse
    # 喵提醒支持 text 参数，title 也可以写在 message 里
    full_msg = f"{title}\n{message}"
    encoded_msg = urllib.parse.quote(full_msg, safe="")
    url = f"{MIAOTIXING_URL.strip()}&text={encoded_msg}"

    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            print("      [通知] 喵提醒推送成功")
        else:
            print(f"      [通知] 喵提醒推送失败: {resp.text[:80]}")
    except Exception as e:
        print(f"      [通知] 喵提醒推送异常: {e}")

# ────────────────────────────────────────────────
#  常量配置
# ────────────────────────────────────────────────
BASE_API   = "https://api.qingcigame.com"
APP_ID     = "58"
PAGE_ID    = "8"
# game_id 不再写死，由接口返回的角色数据携带

# ── 模式A：手机号登录（账号需已完成微信OAuth授权）──
ACCOUNT  = "18610509630"   # 手机号，例如 "13812345678"
PASSWORD = "cgm19930716"      # 密码，   例如 "your_password"

# ── 模式B：直接使用微信抓包的Cookie（优先级高于模式A）──
# 从微信内抓包获取，有效期约2小时。留空则使用模式A。
WECHAT_PHPSESSID   = ""   # 例如: "eyJpdiI6Ild0YmRMb..."
WECHAT_ALIYUNGF_TC = ""   # 例如: "7d2f4341efde92b8..."

HEADERS_BASE = {
    "User-Agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) "
        "Mobile/15E148 MicroMessenger/8.0.69(0x18004531) "
        "NetType/WIFI Language/zh_CN"
    ),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://h5.qingcigame.com",
    "Referer": "https://h5.qingcigame.com/",
}


# ────────────────────────────────────────────────
#  工具函数
# ────────────────────────────────────────────────
def print_sep(title=""):
    width = 55
    if title:
        pad = (width - len(title) - 2) // 2
        print("─" * pad + f" {title} " + "─" * pad)
    else:
        print("─" * width)


def decode_message(data: dict) -> str:
    """从响应字典中提取 message 字段（服务端返回中文 unicode 转义）"""
    return data.get("message", "")


# ────────────────────────────────────────────────
#  Step 1: 账号登录
# ────────────────────────────────────────────────
def login(session: requests.Session, account: str, password: str) -> str | None:
    """
    POST https://api.qingcigame.com/snail/login/account
    Body: account=xxx&password=xxx
    成功后 PHPSESSID 由 session 自动保持。
    返回 user_id 字符串，失败返回 None。
    """
    url = f"{BASE_API}/snail/login/account"
    payload = {"account": account, "password": password}
    headers = {
        **HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }

    print("[1/4] 正在登录...")
    try:
        resp = session.post(url, data=payload, headers=headers, timeout=15)
        result = resp.json()
    except Exception as e:
        print(f"      ✗ 网络异常: {e}")
        return False

    if result.get("code") == 200:
        uid = result.get("data", {}).get("user_id", "")
        print(f"      ✓ 登录成功  账号={account}  user_id={uid}")
        return str(uid)
    else:
        print(f"      ✗ 登录失败: {decode_message(result)}")
        return None


# ────────────────────────────────────────────────
#  Step 2a: 查询签到页支持的 game_id 白名单及主签到 game_id
# ────────────────────────────────────────────────
def get_sign_page_info(session: requests.Session) -> tuple[set[str], str | None]:
    """
    GET https://api.qingcigame.com/game/sign?app_id=58
    从返回的 group 列表中，找到 app_id==APP_ID 的条目：
      - valid_ids : 该签到页支持的所有 game_id（字符串集合），用于过滤角色
      - sign_game_id : 签到/查询状态时实际使用的 game_id（group.game_id 列表的第一个）

    注意：角色归属的 game_id 可能与签到用的 game_id 不同。
    例如 app_id=58 的 group 为 {"game_id":[69,58]}，
    角色可能属于 58（光子服），但签到接口要用 69（安卓服）。
    查询失败则返回 (空集, None)。
    """
    url = f"{BASE_API}/game/sign"
    params = {"app_id": APP_ID}
    headers = {
        **HEADERS_BASE,
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }
    try:
        resp = session.get(url, params=params, headers=headers, timeout=15)
        result = resp.json()
    except Exception:
        return set(), None

    if result.get("code") != 200:
        return set(), None

    app_id_int = int(APP_ID)
    for group in result.get("data", {}).get("group", []):
        if group.get("app_id") == app_id_int:
            game_id_list = group.get("game_id", [])
            valid_ids = {str(gid) for gid in game_id_list}
            # 列表第一个是签到系统主 game_id
            sign_game_id = str(game_id_list[0]) if game_id_list else None
            return valid_ids, sign_game_id

    return set(), None


# ────────────────────────────────────────────────
#  Step 2b: 获取游戏系统用户信息（签到用的 user_id 来源）
# ────────────────────────────────────────────────
def warmup_game_session(session: requests.Session, account: str, user_id: str,
                         sign_game_id: str) -> str | None:
    """
    尝试多种方式让服务端 Session 中写入 game_user_id，以便签到写库成功。

    方式1: GET /game/my?game_id=58/69 （有微信绑定记录的账号有效）
    方式2: POST /game/user/login 或 /game/user/bind （尝试手机号账号激活 game_user 记录）
    方式3: 直接把登录 user_id 注入 Session header（Last resort）
    """
    base_headers = {
        **HEADERS_BASE,
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }

    # ── 方式1: /game/my（有微信绑定记录时有效）──
    for gid in [APP_ID, sign_game_id]:
        try:
            resp = session.get(f"{BASE_API}/game/my",
                               params={"game_id": gid, "page_id": PAGE_ID},
                               headers=base_headers, timeout=15)
            result = resp.json()
            code = result.get("code")
            print(f"      [DEBUG] /game/my?game_id={gid} → code={code} raw={resp.text[:120]}")
            if code == 200:
                uid = result.get("data", {}).get("user_info", {}).get("user_id")
                return str(uid) if uid else None
        except Exception as e:
            print(f"      [WARN] /game/my game_id={gid} 异常: {e}")

    # ── 方式2: POST /snail/user/game_login（尝试手机号账号激活 game_user Session）──
    for path in ["/snail/user/game_login", "/game/user/login", "/snail/game/login"]:
        try:
            payload = {"account": account, "user_id": user_id,
                       "game_id": sign_game_id, "app_id": APP_ID, "page_id": PAGE_ID}
            resp = session.post(f"{BASE_API}{path}", data=payload,
                                headers={**base_headers,
                                         "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
                                timeout=10)
            result = resp.json()
            code = result.get("code")
            print(f"      [DEBUG] POST {path} → code={code} raw={resp.text[:120]}")
            if code == 200:
                uid = (result.get("data", {}) or {}).get("user_id")
                if uid:
                    return str(uid)
        except Exception:
            pass

    # ── 方式3: GET /snail/user/info（尝试刷新 Session 写入 snail user_id）──
    try:
        resp = session.get(f"{BASE_API}/snail/user/info",
                           params={"user_id": user_id, "app_id": APP_ID},
                           headers=base_headers, timeout=10)
        result = resp.json()
        print(f"      [DEBUG] /snail/user/info → code={result.get('code')} raw={resp.text[:120]}")
    except Exception:
        pass

    return None



def get_server_info(session: requests.Session, account: str) -> dict | None:
    """
    GET https://api.qingcigame.com/game/server?account=xxx&app_id=58&page_id=8
    返回选定角色的信息字典（含正确的 game_id 字段），失败返回 None。

    接口原始结构: data -> { "game_id_str": { "platform": [role, ...] } }
    每个 role 对象本身也有 game_id 字段（int），以 role 自带的为准。
    """
    # ── 先获取本签到页支持的 game_id 白名单及主签到 game_id ──
    valid_ids, sign_game_id = get_sign_page_info(session)

    url = f"{BASE_API}/game/server"
    params = {"account": account, "app_id": APP_ID, "page_id": PAGE_ID}
    headers = {
        **HEADERS_BASE,
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }

    print("[2/4] 正在获取角色信息...")
    if valid_ids:
        print(f"      本签到页支持的 game_id: {', '.join(sorted(valid_ids))}  (签到用: {sign_game_id})")
    try:
        resp = session.get(url, params=params, headers=headers, timeout=15)
        result = resp.json()
    except Exception as e:
        print(f"      ✗ 网络异常: {e}")
        return None

    if result.get("code") != 200:
        print(f"      ✗ 获取角色失败: {decode_message(result)}")
        return None

    # 遍历所有 game_id 分组，收集角色，并按白名单过滤
    data = result.get("data", {})
    all_roles = []
    for gid_str, platforms in data.items():
        # 若白名单非空，跳过不在白名单内的 game_id
        if valid_ids and gid_str not in valid_ids:
            continue
        for platform, role_list in platforms.items():
            if not isinstance(role_list, list):
                continue
            for role in role_list:
                if "game_id" not in role or not role["game_id"]:
                    role["game_id"] = int(gid_str)
                all_roles.append(role)

    if not all_roles:
        print("      ✗ 未找到该签到页支持的游戏角色")
        if valid_ids:
            print(f"        （需要 game_id 为 {', '.join(sorted(valid_ids))} 的角色）")
        print("        请先在对应游戏内登录并绑定角色后重试")
        return None

    # 单角色直接使用，多角色默认选第一个并列出所有
    if len(all_roles) == 1:
        chosen = all_roles[0]
    else:
        print(f"      检测到 {len(all_roles)} 个可用角色，自动选择第一个：")
        for i, r in enumerate(all_roles):
            print(
                f"        [{'→' if i == 0 else ' '}] {r['role_name']}"
                f"  服务器={r['server_name']}"
                f"  game_id={r['game_id']}"
            )
        chosen = all_roles[0]

    # 确保角色自身的 game_id 是字符串
    chosen["game_id"] = str(chosen["game_id"])

    # sign_game_id：签到/查询状态时使用的 game_id（可能与角色归属的 game_id 不同）
    # 若查询失败（sign_game_id=None），回退到角色自身的 game_id
    chosen["sign_game_id"] = sign_game_id if sign_game_id else chosen["game_id"]

    print(
        f"      ✓ 角色={chosen['role_name']}"
        f"  服务器={chosen['server_name']}"
        f"  角色game_id={chosen['game_id']}"
        f"  签到game_id={chosen['sign_game_id']}"
        f"  role_id={chosen['role_id']}"
    )
    return chosen


# ────────────────────────────────────────────────
#  Step 3: 绑定角色（同步角色信息到签到系统）
# ────────────────────────────────────────────────
def bind_role(session: requests.Session, account: str, role: dict, user_id: str) -> bool:
    """
    POST https://api.qingcigame.com/game/binds
    将角色信息绑定到签到系统（每次签到前同步一次即可）
    """
    url = f"{BASE_API}/game/binds"
    payload = {
        "account":     account,
        "page_id":     PAGE_ID,
        "game_id":     role["sign_game_id"],     # 签到系统主 game_id
        "type":        role.get("platform", "android"),
        "role_id":     role["role_id"],
        "role_name":   role["role_name"],
        "server_id":   role["server_id"],
        "server_name": role["server_name"],
        "platform":    role.get("platform", "android"),
        "extra":       role.get("extra", ""),
    }
    # 若有 user_id，也带上，让服务端关联 game_user 记录写入 Session
    if user_id:
        payload["user_id"] = user_id
    headers = {
        **HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }

    print("[3/4] 正在同步角色绑定...")
    try:
        resp = session.post(url, data=payload, headers=headers, timeout=15)
        result = resp.json()
    except Exception as e:
        print(f"      ✗ 网络异常: {e}")
        return False

    print(f"      [DEBUG] binds完整响应: {resp.text}")
    if result.get("code") == 200:
        print(f"      ✓ 绑定成功: {decode_message(result)}")
        return True
    else:
        print(f"      ✗ 绑定失败: {decode_message(result)}")
        return False


# ────────────────────────────────────────────────
#  Step 4: 执行签到
# ────────────────────────────────────────────────
def do_sign(session: requests.Session, role: dict, user_id: str, account: str = "") -> bool:
    """
    POST https://api.qingcigame.com/game/sign/record
    服务端从 Session 取 game_user_id 写库；若 Session 里没有，
    尝试额外传 role_id / account 让服务端通过绑定表反查。
    """
    url = f"{BASE_API}/game/sign/record"
    payload = {
        "app_id":  APP_ID,
        "page_id": PAGE_ID,
        "game_id": role["sign_game_id"],
        "role_id": role["role_id"],
        "account": account,
    }
    # 尝试带 user_id，让服务端通过账号/user_id 反查 game_user 记录
    if user_id:
        payload["user_id"] = user_id
    print(f"      [DEBUG] 签到payload: {payload}")
    print(f"      [DEBUG] Cookie: { {c.name: c.value[:20]+'...' for c in session.cookies} }")
    headers = {
        **HEADERS_BASE,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }

    print("[4/4] 正在执行签到...")
    try:
        resp = session.post(url, data=payload, headers=headers, timeout=15)
        print(f"      [DEBUG] 完整响应: {resp.text}")  # 打印完整响应
        result = resp.json()
    except Exception as e:
        print(f"      ✗ 网络异常: {e}")
        return False

    code    = result.get("code")
    message = decode_message(result)

    if code == 200:
        print(f"      ✓ 签到成功: {message}")
        return True
    elif code == 500:
        # 服务端在"重复签到"时固定返回 500，需结合签到状态二次确认
        print(f"      ? 服务端返回 500，将通过签到状态二次确认...")
        return None   # None = 需要调用方再核查
    else:
        print(f"      ✗ 签到失败 (code={code}): {message}")
        return False


# ────────────────────────────────────────────────
#  附加：查询签到状态（同时返回 is_get 供外部判断）
# ────────────────────────────────────────────────
def get_sign_status(session: requests.Session, role: dict, silent: bool = False) -> bool | None:
    """
    GET https://api.qingcigame.com/game/sign/list
    展示本周/本月签到详情。
    返回值: True=今日已签  False=今日未签  None=查询失败
    silent=True 时只返回状态，不打印详情。
    """
    url = f"{BASE_API}/game/sign/list"
    params = {
        "game_id": role["sign_game_id"],         # 签到系统主 game_id
        "role_id": role["role_id"],
        "app_id":  APP_ID,
    }
    headers = {
        **HEADERS_BASE,
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Dest": "empty",
    }
    try:
        resp = session.get(url, params=params, headers=headers, timeout=15)
        result = resp.json()
    except Exception:
        return None

    if result.get("code") != 200:
        return None

    data        = result.get("data", {})
    sign_total  = data.get("sign_total", 0)
    week_data   = data.get("week", {})
    is_get_raw  = data.get("is_get", False)
    game_name   = data.get("name", "签到")

    # is_get 可能是 bool True/False 或整数 0/1
    is_get = bool(is_get_raw) and is_get_raw != "0" and is_get_raw != 0

    if silent:
        return is_get

    print_sep("签到状态")
    print(f"  活动名称  : {game_name}")
    print(f"  本周累计  : {sign_total} 天")
    print(f"  今日已签  : {'是' if is_get else '否'}")
    print()
    print("  本周奖励预览:")
    week_names = {
        "1": "周一", "2": "周二", "3": "周三",
        "4": "周四", "5": "周五", "6": "周六", "7": "周日",
    }
    for k, v in week_data.items():
        drawn = v.get("is_draw")
        drawn_str = "✓已领" if drawn and drawn != "0" else "○未领"
        print(f"    {week_names.get(k, k)} {drawn_str}")
    print_sep()
    return is_get


# ────────────────────────────────────────────────
#  主流程
# ────────────────────────────────────────────────
def main():
    print_sep()
    print("  青瓷游戏 仙剑签到脚本")
    print(f"  运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print_sep()

    # ── 获取账号密码（优先级：脚本内配置 > 命令行参数 > 交互输入）──
    if ACCOUNT and PASSWORD:
        account  = ACCOUNT.strip()
        password = PASSWORD.strip()
    elif ACCOUNT and WECHAT_PHPSESSID:
        # 模式B：有Cookie，只需账号不需要密码
        account  = ACCOUNT.strip()
        password = ""
    elif len(sys.argv) >= 3:
        account  = sys.argv[1].strip()
        password = sys.argv[2].strip()
        print(f"  账号: {account}  (来自命令行参数)")
    else:
        print("  请输入账号信息（密码不会显示）")
        account  = input("  账号（手机号）: ").strip()
        if not WECHAT_PHPSESSID.strip():
            password = getpass.getpass("  密码: ").strip()
        else:
            password = ""

    if not account:
        print("  ✗ 账号不能为空")
        sys.exit(1)
    if not WECHAT_PHPSESSID.strip() and not password:
        print("  ✗ 模式A下密码不能为空")
        sys.exit(1)

    print_sep()

    # ── 创建 Session（自动保持 Cookie）──
    session = requests.Session()
    session.headers.update(HEADERS_BASE)

    # ── 判断运行模式 ──
    wechat_sessid = WECHAT_PHPSESSID.strip()
    wechat_tc     = WECHAT_ALIYUNGF_TC.strip()

    if wechat_sessid:
        # ════ 模式B：直接注入微信Cookie ════
        print("  运行模式: B（直接使用微信Cookie）")
        print_sep()
        session.cookies.set("PHPSESSID",   wechat_sessid, domain=".qingcigame.com")
        session.cookies.set("aliyungf_tc", wechat_tc,     domain=".qingcigame.com")

        # 用 /game/server 查询账号（从Cookie推断账号，或用配置的ACCOUNT）
        if not account:
            print("  ✗ 模式B下请同时填写 ACCOUNT 手机号（用于查询角色）")
            sys.exit(1)
        print(f"  账号: {account}  (来自脚本配置)")
        print_sep()

        # 不需要登录步骤，直接获取角色
        role = get_server_info(session, account)
        if not role:
            sys.exit(1)

        # 绑定角色（同步角色信息）
        bind_role(session, account, role, "")

        user_id = ""  # 模式B不需要 snail user_id
    else:
        # ════ 模式A：手机号登录 ════
        print("  运行模式: A（手机号登录）")
        print_sep()

        # ── 预热：先访问 H5 签到页，让 SLB 分配 aliyungf_tc 会话保持 Cookie ──
        try:
            session.get(
                "https://h5.qingcigame.com/package/template/enterb59uwn8hdzo",
                params={"app_id": APP_ID},
                headers={**HEADERS_BASE, "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"},
                timeout=15,
            )
        except Exception:
            pass

        # 1. 登录
        user_id = login(session, account, password)
        if not user_id:
            sys.exit(1)

        # 2. 获取角色
        role = get_server_info(session, account)
        if not role:
            sys.exit(1)

        # 3. 绑定角色
        bind_role(session, account, role, user_id)

    # 4. 签到前先检查今日是否已签
    print("[4/4] 正在检查今日签到状态...")
    already_signed = get_sign_status(session, role, silent=True)
    if already_signed is True:
        print("      ✓ 今日已经签到过了，无需重复签到")
        sign_result = True
    else:
        # 未签或查询失败，都尝试执行签到
        sign_result = do_sign(session, role, user_id, account)

        # do_sign 返回 None 表示服务端 500，再查一次状态确认
        if sign_result is None:
            confirmed = get_sign_status(session, role, silent=True)
            if confirmed is True:
                print("      ✓ 二次确认：今日签到已完成")
                sign_result = True
            else:
                print("      ✗ 二次确认：签到未完成，可能是真实服务器错误")
                sign_result = False

    # 5. 查询并打印签到详情
    get_sign_status(session, role)

    print_sep()
    if sign_result:
        print("  🎉 签到流程完成！")
        # 签到成功 → 不发通知
    else:
        print("  ⚠  签到未成功，请检查上方错误信息")
        # 签到未成功 → 发送系统通知提醒
        role_name = role.get("role_name", "") if role else ""
        notify_msg = (
            f"角色【{role_name}】今日尚未签到！\n"
            f"请手动签到 https://h5.qingcigame.com/package/template/enterb59uwn8hdzo?app_id=58\n"
            f"时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        send_notify("⚠ 青瓷签到失败提醒", notify_msg)
    print_sep()


if __name__ == "__main__":
    main()
