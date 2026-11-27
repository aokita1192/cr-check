import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import feedback_logic as fl

ITEMS = [
    {"no": 1, "status": "ok", "serif": "あ", "chusyaku": "", "ai_result": "問題なし"},
    {"no": 2, "status": "ng", "serif": "い", "chusyaku": "※", "ai_result": "「い → 案1：x案2：y（r）」"},
    {"no": 3, "status": "ng", "serif": "う", "chusyaku": "", "ai_result": "「う → 案1：x案2：y（r）」"},
]


def test_validate():
    assert fl.validate_item("ng", {"v": "disagree"}) == "reason"
    assert fl.validate_item("ng", {"v": "disagree", "reason": "other", "memo": " "}) == "memo"
    assert fl.validate_item("ng", {"v": "disagree", "reason": "fp"}) is None
    assert fl.validate_item("ng", {"v": "agree"}) is None and fl.validate_item("ng", {}) is None
    assert fl.validate_item("ok", {"v": "disagree", "memo": ""}) == "memo"
    assert fl.validate_item("ok", {"v": "disagree", "memo": "x"}) is None


def test_summarize_multi_items():
    st = {1: "ok", 2: "ng", 3: "ng"}
    fb = {1: {"v": "disagree", "memo": "最安は注釈が必要"},
          2: {"v": "disagree", "reason": "fp"}, 3: {"v": "agree"}}
    s = fl.summarize(st, fb)
    assert (s["ai_count"], s["excluded"], s["missed"], s["final_count"]) == (2, 1, 1, 2)
    assert (s["agree"], s["disagree"], s["input_count"], s["error_count"]) == (1, 2, 3, 0)
    assert s["has_override"]
    # 根拠違い・修正案不適切は要修正のまま
    s2 = fl.summarize({2: "ng"}, {2: {"v": "disagree", "reason": "basis"}})
    assert s2["final_count"] == 1 and not s2["has_override"]
    # エラー件数
    assert fl.summarize({2: "ng", 1: "ok"}, {2: {"v": "disagree"}, 1: {"v": "disagree"}})["error_count"] == 2


def test_compose_text():
    assert "誤検知" in fl.compose_feedback_text("ng", {"reason": "fp", "memo": "概算不要"})
    assert fl.compose_feedback_text("ng", {"reason": "other", "memo": "自由記述"}) == "自由記述"
    assert fl.compose_feedback_text("ok", {"memo": "最安は根拠必須"}).endswith("最安は根拠必須")


def test_plan_save_idempotent_and_retract():
    fb = {2: {"v": "disagree", "reason": "fp"}, 1: {"v": "disagree", "memo": "m"}, 3: {"v": "agree"}}
    rows, prev = fl.plan_save({}, ITEMS, fb)
    assert sorted(r["item_no"] for r in rows) == [1, 2]            # 同意は保存しない
    assert {r["item_no"]: r["reason_code"] for r in rows} == {1: "missed", 2: "fp"}
    rows2, prev2 = fl.plan_save(prev, ITEMS, fb)
    assert rows2 == [] and prev2 == prev                            # 再保存しても重複しない
    fb[2] = {"v": "disagree", "reason": "basis"}                    # 変更した項目だけ追記
    rows3, prev3 = fl.plan_save(prev2, ITEMS, fb)
    assert [r["item_no"] for r in rows3] == [2]
    fb[1] = {"v": "agree"}                                          # 取り消し → retract
    rows4, prev4 = fl.plan_save(prev3, ITEMS, fb)
    assert [(r["item_no"], r["verdict"]) for r in rows4] == [(1, "retract")] and 1 not in prev4


def test_invalid_items_not_saved():
    rows, _ = fl.plan_save({}, ITEMS, {2: {"v": "disagree"}})       # 理由なし
    assert rows == []


def test_effective_records():
    recs = [
        {"serif": "旧", "feedback": "旧形式", "run_id": ""},
        {"run_id": "r1", "item_no": 2, "verdict": "disagree", "feedback": "v1"},
        {"run_id": "r1", "item_no": 2, "verdict": "disagree", "feedback": "v2"},
        {"run_id": "r1", "item_no": 1, "verdict": "disagree", "feedback": "x"},
        {"run_id": "r1", "item_no": 1, "verdict": "retract", "feedback": ""},
        {"run_id": "r2", "item_no": 2, "verdict": "disagree", "feedback": "別run"},
    ]
    got = sorted(r["feedback"] for r in fl.effective_records(recs))
    assert got == sorted(["v2", "旧形式", "別run"])
