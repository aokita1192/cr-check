"""管理ダッシュボードの集計ロジック（Streamlit非依存・テスト可能）。

ログ行の分類
- 旧ログ    : user_email が空。ユーザー情報・トークン・コストが未計上の古い形式。
- 旧ロジック: ユーザーはあるが total_input_tokens が 0 で input_tokens > 0
              （キャッシュトークン未計上の時期。コストは実際より低い）。
- 計上済み  : 旧ログではなく cost_usd > 0 の実行。平均コストの分母に使う。
"""
from __future__ import annotations

import re
from datetime import date, timedelta

import pandas as pd

TOKEN_COLS = ["input_tokens", "cache_write_5m", "cache_write_1h", "cache_read_tokens", "output_tokens"]


def normalize_service(name: object) -> str:
    """先頭の絵文字・空白を除去（例: '🚗 車買取（記事）' → '車買取（記事）'）。"""
    s = "" if name is None or (isinstance(name, float) and pd.isna(name)) else str(name)
    return re.sub(r"^[^\w（(]+", "", s).strip()


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    """分類列を付与した新しいDataFrameを返す。"""
    out = df.copy()
    if "user_email" not in out.columns:
        out["user_email"] = ""
    out["user_email"] = out["user_email"].fillna("").astype(str).str.strip()
    if "service" not in out.columns:
        out["service"] = ""
    out["service_name"] = out["service"].map(normalize_service)
    out["is_legacy_log"] = out["user_email"] == ""
    out["is_old_logic"] = (
        ~out["is_legacy_log"] & (out["total_input_tokens"] == 0) & (out["input_tokens"] > 0)
    )
    out["is_costed"] = ~out["is_legacy_log"] & (out["cost_usd"] > 0)
    out["date"] = out["timestamp_utc"].dt.date
    return out


def period_bounds(preset: str, today: date, min_dt: date, max_dt: date) -> tuple[date, date]:
    """プリセット → (開始日, 終了日)。基準は今日(UTC)。全期間はデータの最小〜最大日。"""
    if preset == "7d":
        return today - timedelta(days=6), today
    if preset == "30d":
        return today - timedelta(days=29), today
    return min_dt, max_dt


def filter_period(df: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    return df[(df["date"] >= start) & (df["date"] <= end)]


def summarize(df: pd.DataFrame, usd_jpy: float) -> dict:
    users = df[~df["is_legacy_log"]]
    costed = df[df["is_costed"]]
    total_cost = float(df["cost_usd"].sum())
    n_costed = int(len(costed))
    avg_usd = (float(costed["cost_usd"].sum()) / n_costed) if n_costed else 0.0
    inp = int(df["input_tokens"].sum())
    cw5 = int(df["cache_write_5m"].sum())
    cw1 = int(df["cache_write_1h"].sum())
    cr = int(df["cache_read_tokens"].sum())
    total_in = inp + cw5 + cw1 + cr

    def pct(x: int) -> float:
        return (x / total_in * 100) if total_in else 0.0

    return {
        "total_cost_usd": total_cost,
        "total_cost_jpy": total_cost * usd_jpy,
        "runs": int(len(df)),
        "rows": int(df["row_count"].sum()),
        "users": int(users["user_email"].nunique()),
        "legacy_runs": int(df["is_legacy_log"].sum()),
        "costed_runs": n_costed,
        "avg_cost_usd": avg_usd,
        "avg_cost_jpy": avg_usd * usd_jpy,
        "has_old_logic": bool(df["is_old_logic"].any()),
        "tokens": {"input": inp, "cache_read": cr, "cache_write_5m": cw5,
                   "cache_write_1h": cw1, "cache_write": cw1 + cw5,
                   "output": int(df["output_tokens"].sum()), "total_input": total_in},
        "pct": {"input": pct(inp), "cache_read": pct(cr), "cache_write": pct(cw1 + cw5)},
    }


def daily_costs(df: pd.DataFrame, start: date, end: date, usd_jpy: float) -> pd.DataFrame:
    """start〜end の全日（データなしは0）の日別集計。"""
    days = pd.date_range(start, end, freq="D").date
    g = df.groupby("date").agg(
        審査回数=("row_count", "count"), セリフ数=("row_count", "sum"),
        入力Token=("input_tokens", "sum"), キャッシュ書込5m=("cache_write_5m", "sum"),
        キャッシュ書込1h=("cache_write_1h", "sum"), キャッシュ読込=("cache_read_tokens", "sum"),
        出力Token=("output_tokens", "sum"), コストUSD=("cost_usd", "sum"),
    )
    out = g.reindex(days, fill_value=0)
    out.index.name = "日付"
    out["入力合計Token"] = out[["入力Token", "キャッシュ書込5m", "キャッシュ書込1h", "キャッシュ読込"]].sum(axis=1)
    out["コスト円"] = (out["コストUSD"] * usd_jpy).round(0).astype(int)
    out["読取率%"] = (out["キャッシュ読込"] / out["入力合計Token"].where(out["入力合計Token"] > 0, 1) * 100).round(1)
    return out.reset_index()


def by_user(df: pd.DataFrame) -> pd.DataFrame:
    u = df[~df["is_legacy_log"]]
    if u.empty:
        return pd.DataFrame(columns=["メールアドレス", "審査回数", "セリフ数", "入力Token",
                                     "キャッシュ読込", "出力Token", "コストUSD", "最終利用"])
    g = u.groupby("user_email").agg(
        審査回数=("row_count", "count"), セリフ数=("row_count", "sum"),
        入力Token=("input_tokens", "sum"), キャッシュ読込=("cache_read_tokens", "sum"),
        出力Token=("output_tokens", "sum"), コストUSD=("cost_usd", "sum"),
        最終利用=("timestamp_utc", "max"),
    ).reset_index().rename(columns={"user_email": "メールアドレス"})
    return g.sort_values(["審査回数", "コストUSD"], ascending=False).reset_index(drop=True)


def by_service_legacy(df: pd.DataFrame) -> pd.DataFrame:
    l = df[df["is_legacy_log"]]
    if l.empty:
        return pd.DataFrame(columns=["サービス", "審査回数", "セリフ数"])
    g = l.groupby("service_name").agg(審査回数=("row_count", "count"), セリフ数=("row_count", "sum"))
    return g.reset_index().rename(columns={"service_name": "サービス"}).sort_values("審査回数", ascending=False)
