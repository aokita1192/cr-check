import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from datetime import date
import pandas as pd
import dashboard_logic as dl

NUM = ["row_count","api_calls","input_tokens","cache_write_5m","cache_write_1h",
       "cache_read_tokens","total_input_tokens","output_tokens"]

def mk(rows):
    df = pd.DataFrame(rows)
    for c in NUM:
        if c not in df: df[c] = 0
    df["timestamp_utc"] = pd.to_datetime(df["timestamp_utc"])
    return dl.prepare(df)

def row(ts, email, svc="🚗 車買取", cost=0.0, inp=0, cr=0, out=0, cw5=0, cw1=0, rc=1):
    return dict(timestamp_utc=ts, user_email=email, service=svc, cost_usd=cost, row_count=rc,
                input_tokens=inp, cache_read_tokens=cr, output_tokens=out, cache_write_5m=cw5,
                cache_write_1h=cw1, total_input_tokens=inp+cr+cw5+cw1)

def mock():
    rows = [row("2026-09-08 01:00:00", "", "車買取", rc=12000) for _ in range(248)]
    rows += [row("2026-09-09 01:00:00", None, "引越し", rc=6820) for _ in range(94)]
    rows += [row("2026-11-25 08:22:00", "a@x.inc", cost=0.5, inp=1000, cr=5000, out=100, rc=20) for _ in range(44)]
    return mk(rows)

def test_avg_uses_costed_runs_only():
    df = mock()
    s = dl.summarize(df, 150)
    assert s["runs"] == 386 and s["legacy_runs"] == 342 and s["costed_runs"] == 44
    assert abs(s["avg_cost_usd"] - 0.5) < 1e-9           # 22.0/44, not /386
    assert s["users"] == 1                                 # 旧ログ(空/None)を人数に含めない

def test_users_exclude_legacy_and_by_service_legacy():
    df = mock()
    assert list(dl.by_user(df)["メールアドレス"]) == ["a@x.inc"]
    sv = dl.by_service_legacy(df).set_index("サービス")
    assert sv.loc["車買取", "審査回数"] == 248 and sv.loc["引越し", "審査回数"] == 94

def test_error_run_is_not_legacy():
    df = mk([row("2026-11-01 00:00:00", "a@x.inc", cost=0.0)])
    assert not df["is_legacy_log"].any() and not df["is_old_logic"].any() and not df["is_costed"].any()
    assert dl.summarize(df, 150)["avg_cost_usd"] == 0.0   # 0除算しない

def test_old_logic_flag():
    d = mk([dict(row("2026-11-01 00:00:00", "a@x.inc", cost=0.1, inp=500), total_input_tokens=0)])
    assert d["is_old_logic"].all() and dl.summarize(d, 150)["has_old_logic"]
    assert not mock()["is_old_logic"].any()

def test_daily_zero_fill_79_days():
    df = mock()
    d = dl.daily_costs(df, date(2026, 9, 8), date(2026, 11, 25), 150)
    assert len(d) == 79
    assert d.loc[d["日付"] == date(2026, 11, 25), "審査回数"].iloc[0] == 44
    assert (d["審査回数"] > 0).sum() == 3

def test_period_and_empty():
    df = mock()
    s, e = dl.period_bounds("7d", date(2026, 11, 27), date(2026, 9, 8), date(2026, 11, 25))
    assert (s, e) == (date(2026, 11, 21), date(2026, 11, 27))
    sub = dl.filter_period(df, s, e)
    assert len(sub) == 44
    empty = dl.filter_period(df, date(2027, 1, 1), date(2027, 1, 2))
    z = dl.summarize(empty, 150)
    assert z["runs"] == 0 and z["pct"]["input"] == 0 and z["avg_cost_usd"] == 0.0
    assert len(dl.daily_costs(empty, date(2027,1,1), date(2027,1,2), 150)) == 2

def test_pct_sums_to_100_and_service_name():
    s = dl.summarize(mock(), 150)
    assert abs(sum(s["pct"].values()) - 100) < 1e-9
    assert dl.normalize_service("🚗 車買取（記事）") == "車買取（記事）"
    assert dl.normalize_service("🏠 引越し") == "引越し" and dl.normalize_service(None) == ""
