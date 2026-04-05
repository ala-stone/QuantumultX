# -*- coding: utf-8 -*-
"""
TapTap 游戏自动签到脚本 v2.2
- 自动检测签到状态
- 自动领取礼包
- Bark 通知包含礼包名和兑换码
"""

import requests
import urllib.parse
from datetime import datetime

# ============ 配置区域 ============

BARK_KEY = "BbbyK4F8Xtndnzd6xHAqrJ"
BARK_SOUND = "choo"

COOKIE = "ssxmod_itna=1-QqUhqAxjxmxGrxfxeKYKitG2jHGOTevdDXDUqAQD2DIqGQGcD8hx0pxS3_92C_Ahx3DGuihQYQ8DN4DBkiprDnqD82DQeDvKPqhi5l_Yr_NIatzxSGdt73ex4vLkVIok9fOQ5U89UhkvvrDY=DG83DzqDytOeeKxGGDDUYxG6TDDeDt_iDf_ooLeTDb32QAOeKGdcr/bEY3MohUYmGCmhd/rhx7iY4CW=CX0vdUiADV4fXDAoFk/defixYvnRd6SiD8dbDfqDStxDgDGpdocnrQ/_SF5047ix54LHbGfvs4_Ynl8mYYFxeYDq_DqB5fQIDD; ssxmod_itna2=1-QqUhqAxjxmxGrxfxeKYKitG2jHGOTevdDXDUqAQD2DIqGQGcD8hx0pxS3_92C_Ahx3DGuihQYQ80YD==R2Yviw/lOPzK/PmBp34Et1fD; web_app_uuid=28f297d9-bbc0-4873-b66d-1b9daec7daf6; XSRF-TOKEN=xn3jwzt5y8ydrjm5l3wo; acw_tc=7b3975b717753368534548915e690e2cc3f45f8dde147d72746e2c608126c6; apk_download_url_postfix=/organic-direct; user_id=559132083; TAPTAP_SESSION=oKSxmGcEBqYD_lt8F5kmuXINvdO4Kn7GD9QqH9fm0qYvrRNindxPXQ; _ga=GA1.1.1111094721.1728263721; _ga_6G9NWP07QM=GS2.1.s1771718748$o32$g0$t1771718748$j60$l0$h0; ACCOUNT_LOGGED_USER_FROM_WWW=NTEhP2OuBXn7mMLmkbqdEg%3D%3D; CONSOLES_TOKEN_FROM_WWW=9F%2BOh4S5AcvWqMndIULHww%3D%3D"

XSRF_TOKEN = "xn3jwzt5y8ydrjm5l3wo"
SMFP = "20230622145354884a5c63c3f0398086c6865d8c1a4d7c01cb1c81c006e517"
USER_ID = "559132083"
ACTIVITY_ID = "wxmxb2il"

# ============ 核心逻辑 ============

def send_bark(title, body):
    """发送 Bark 通知"""
    url = f"https://api.day.app/{BARK_KEY}/{urllib.parse.quote(title)}/{urllib.parse.quote(body)}?sound={BARK_SOUND}"
    try:
        r = requests.get(url, timeout=10)
        ok = r.json().get('code') == 200
        print(f"[BARK] {'OK' if ok else 'FAIL'}")
        return ok
    except Exception as e:
        print(f"[BARK] ERR: {e}")
        return False

def get_headers():
    return {
        'Cookie': COOKIE,
        'X-XSRF-TOKEN': XSRF_TOKEN,
        'x-smfp': SMFP,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.taptap.cn',
        'Referer': f'https://www.taptap.cn/events/game-sign/{ACTIVITY_ID}',
    }

def get_activity_detail():
    """获取活动详情，包含所有礼包信息"""
    url = f"https://www.taptap.cn/webapiv2/event/game-sign/detail/{ACTIVITY_ID}?X-UA=V%3D1%26PN%3DWebActivity%26LANG%3Dzh_CN%26LOC%3DCN%26PLT%3DiOS%26UID%3D28f297d9-bbc0-4873-b66d-1b9daec7daf6%26VN_CODE%3D3%26VID%3D{USER_ID}"
    
    try:
        r = requests.get(url, headers=get_headers(), timeout=10)
        data = r.json()
        if data.get('success'):
            return data.get('data', {})
    except Exception as e:
        print(f"[ERR] 获取活动详情失败: {e}")
    return None

def get_my_awards():
    """获取已领取的礼包列表"""
    url = f"https://www.taptap.cn/webapiv2/event/game-sign/v2/my-award-list/{ACTIVITY_ID}?X-UA=V%3D1%26PN%3DWebActivity%26LANG%3Dzh_CN%26LOC%3DCN%26PLT%3DiOS%26UID%3D28f297d9-bbc0-4873-b66d-1b9daec7daf6%26VN_CODE%3D3%26VID%3D{USER_ID}"
    
    try:
        r = requests.get(url, headers=get_headers(), timeout=10)
        data = r.json()
        if data.get('success'):
            return data.get('data', {}).get('award_list', [])
    except Exception as e:
        print(f"[ERR] 获取礼包列表失败: {e}")
    return None

def do_signin(award_id):
    """执行签到"""
    url = f"https://www.taptap.cn/webapiv2/event/game-sign/v2/check-in-accept-award?X-UA=V%3D1%26PN%3DWebActivity%26LANG%3Dzh_CN%26LOC%3DCN%26PLT%3DiOS%26UID%3D28f297d9-bbc0-4873-b66d-1b9daec7daf6%26VN_CODE%3D3%26VID%3D{USER_ID}"
    
    headers = get_headers()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    
    data = {'award_id': award_id, 'smfp': SMFP}
    
    try:
        r = requests.post(url, headers=headers, data=data, timeout=10)
        result = r.json()
        
        if result.get('success'):
            prize = result.get('data', {}).get('prize', {})
            code = result.get('data', {}).get('code', '')
            return True, prize.get('title', ''), code
        else:
            msg = result.get('data', {}).get('msg', result.get('message', '未知错误'))
            return False, '', msg
    except Exception as e:
        return False, '', str(e)

def main():
    print("=" * 50)
    print(f"TapTap 签到 v2.2 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)
    
    # 1. 获取活动详情
    print("[STEP1] 获取活动详情...")
    detail = get_activity_detail()
    if not detail:
        print("[FAIL] 无法获取活动详情")
        send_bark("TapTap签到失败", "无法获取活动详情")
        return
    
    # 获取所有可领取的礼包
    award_pool = detail.get('award_pool', {}).get('award_list', [])
    if not award_pool:
        print("[FAIL] 没有可领取的礼包")
        send_bark("TapTap签到失败", "没有可领取的礼包")
        return
    
    print(f"[INFO] 活动共 {len(award_pool)} 个礼包")
    
    # 2. 获取已领取的礼包
    print("[STEP2] 获取已领取礼包...")
    my_awards = get_my_awards()
    if my_awards is None:
        print("[FAIL] 无法获取已领取列表")
        send_bark("TapTap签到失败", "Cookie可能已过期")
        return
    
    print(f"[INFO] 已领取 {len(my_awards)} 个礼包")
    
    # 3. 判断今天是否已签到
    if len(my_awards) >= 3:
        # 已领取3个或以上，今天已签到
        print("[OK] 今日已签到")
        
        # 收集所有礼包码
        all_codes = []
        for a in my_awards:
            title = a.get('prize', {}).get('title', '')
            c = a.get('code', '')
            if c:
                all_codes.append(f"{title}:{c}")
        
        codes_str = " | ".join(all_codes)
        send_bark("TapTap已签到", codes_str)
        return
    
    # 4. 尝试签到今天的礼包
    print("[STEP3] 尝试签到...")
    
    # 找到下一个应该领取的礼包
    next_day = len(my_awards) + 1
    target_award = None
    
    for award in award_pool:
        if award.get('accept_threshold') == next_day:
            target_award = award
            break
    
    if not target_award:
        print("[FAIL] 未找到今日礼包")
        send_bark("TapTap签到失败", "未找到今日礼包")
        return
    
    award_id = target_award.get('award_id')
    print(f"[INFO] 准备领取第 {next_day} 天礼包 (award_id={award_id})")
    
    # 执行签到
    success, title_or_msg, code = do_signin(award_id)
    
    if success:
        print(f"[SUCCESS] 签到成功: {title_or_msg}")
        print(f"[CODE] {code}")
        
        # 重新获取已领取列表
        my_awards = get_my_awards()
        all_codes = []
        for a in my_awards:
            t = a.get('prize', {}).get('title', '')
            c = a.get('code', '')
            if c:
                all_codes.append(f"{t}:{c}")
        
        codes_str = " | ".join(all_codes)
        send_bark("TapTap签到成功", codes_str)
    elif "不能重复领取" in title_or_msg or "已签到" in title_or_msg:
        print("[OK] 今日已签到（重复领取提示）")
        
        # 收集所有礼包码
        all_codes = []
        for a in my_awards:
            t = a.get('prize', {}).get('title', '')
            c = a.get('code', '')
            if c:
                all_codes.append(f"{t}:{c}")
        
        codes_str = " | ".join(all_codes)
        send_bark("TapTap已签到", codes_str)
    else:
        print(f"[FAIL] 签到失败: {title_or_msg}")
        send_bark("TapTap签到失败", title_or_msg)
    
    print("=" * 50)

if __name__ == '__main__':
    main()
