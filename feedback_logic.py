"""担当者フィードバックのロジック（Streamlit非依存・テスト可能）。

項目の状態
  要修正の項目: {"v": None|"agree"|"disagree", "reason": "fp|basis|fix|other"|"", "memo": str}
  問題なしの項目: {"v": None|"disagree", "memo": str}   （disagree = 見逃し報告）
保存方針
  - 保存するのは「同意しない」だけ（同意は学習に使わないため保存しない）。
  - 同じ (run_id, item_no) は最後の行が有効。保存後に取り消した項目は retract 行を追記する。
"""
from __future__ import annotations

import json

REASONS: list[tuple[str, str]] = [
    ("fp", "違反ではない（誤検知）"),
    ("basis", "違反だが、理由・根拠が違う"),
    ("fix", "修正案が適切でない"),
    ("other", "その他"),
]
REASON_LABEL = dict(REASONS)

FEEDBACK_HEADERS = ["timestamp", "user_email", "service", "serif", "chusyaku", "ai_result", "feedback",
                    "run_id", "item_no", "verdict", "reason_code", "memo"]

_GUIDE = {
    "fp": "AIの指摘は誤検知（違反ではない）。この表現は指摘しないこと。",
    "basis": "違反ではあるが、AIが示した理由・根拠が違う。",
    "fix": "指摘は妥当だが、修正案が適切でない。",
    "other": "",
}


def validate_item(status: str, st: dict) -> str | None:
    """None=OK / 'reason' / 'memo'。status は 'ng' か 'ok'。"""
    if st.get("v") != "disagree":
        return None
    memo = (st.get("memo") or "").strip()
    if status == "ng":
        reason = st.get("reason") or ""
        if not reason:
            return "reason"
        if reason == "other" and not memo:
            return "memo"
        return None
    return None if memo else "memo"


def summarize(statuses: dict[int, str], fb: dict[int, dict]) -> dict:
    """statuses: item_no -> 'ng'|'ok'。 fb: item_no -> state。"""
    ai_ng = sum(1 for s in statuses.values() if s == "ng")
    agree = disagree = missed = excluded = errors = 0
    for no, s in statuses.items():
        st = fb.get(no) or {}
        if validate_item(s, st):
            errors += 1
        if s == "ng":
            if st.get("v") == "agree":
                agree += 1
            elif st.get("v") == "disagree":
                disagree += 1
                if st.get("reason") == "fp":
                    excluded += 1
        elif st.get("v") == "disagree":
            missed += 1
    return {
        "ai_count": ai_ng, "agree": agree, "disagree": disagree + missed, "ng_disagree": disagree,
        "missed": missed, "excluded": excluded, "final_count": ai_ng - excluded + missed,
        "input_count": agree + disagree + missed, "error_count": errors,
        "has_override": bool(excluded or missed),
    }


def compose_feedback_text(status: str, st: dict) -> str:
    """プロンプトの『担当者の指示』に入れる文面。"""
    memo = (st.get("memo") or "").strip()
    if status == "ok":
        return f"AIは問題なしと判断したが見逃し。本来は要修正：{memo}"
    guide = _GUIDE.get(st.get("reason") or "", "")
    return f"{guide}{memo}".strip() if guide else memo


def signature(status: str, st: dict) -> str:
    return json.dumps([status, st.get("v"), st.get("reason") or "", (st.get("memo") or "").strip()],
                      ensure_ascii=False)


def collect_disagreements(items: list[dict], fb: dict[int, dict]) -> dict[int, dict]:
    """items: [{no, status, serif, chusyaku, ai_result}]。同意しない項目だけ返す。"""
    out: dict[int, dict] = {}
    for it in items:
        st = fb.get(it["no"]) or {}
        if st.get("v") == "disagree" and it["status"] in ("ng", "ok") and not validate_item(it["status"], st):
            out[it["no"]] = {**it, "st": st}
    return out


def plan_save(prev: dict[int, str], items: list[dict], fb: dict[int, dict]) -> tuple[list[dict], dict[int, str]]:
    """追記すべき行（辞書）と、保存後の署名マップを返す。"""
    cur = collect_disagreements(items, fb)
    rows: list[dict] = []
    new_prev = dict(prev)
    for no, it in cur.items():
        sig = signature(it["status"], it["st"])
        if prev.get(no) == sig:
            continue
        st = it["st"]
        rows.append({
            "serif": it["serif"], "chusyaku": it.get("chusyaku", ""), "ai_result": it["ai_result"],
            "feedback": compose_feedback_text(it["status"], st), "item_no": no, "verdict": "disagree",
            "reason_code": "missed" if it["status"] == "ok" else st.get("reason", ""),
            "memo": (st.get("memo") or "").strip(),
        })
        new_prev[no] = sig
    by_no = {it["no"]: it for it in items}
    for no in list(prev):
        if no not in cur:
            it = by_no.get(no, {})
            rows.append({"serif": it.get("serif", ""), "chusyaku": it.get("chusyaku", ""),
                         "ai_result": it.get("ai_result", ""), "feedback": "", "item_no": no,
                         "verdict": "retract", "reason_code": "", "memo": ""})
            new_prev.pop(no, None)
    return rows, new_prev


def effective_records(records: list[dict]) -> list[dict]:
    """シートの全行から学習に使う行だけを返す（retract除外・同一(run_id,item_no)は最後が有効）。"""
    last: dict[tuple, dict] = {}
    plain: list[dict] = []
    for i, r in enumerate(records):
        rid = str(r.get("run_id", "") or "").strip()
        if rid and str(r.get("item_no", "")).strip() != "":
            last[(rid, str(r.get("item_no")))] = r
        elif str(r.get("feedback", "")).strip():
            plain.append(r)          # 旧形式の行
    keep = [r for r in last.values() if r.get("verdict") != "retract" and str(r.get("feedback", "")).strip()]
    return plain + keep
