import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import result_parser as rp


def test_new_format_full():
    t = "「比較した中で1番安い見積もりがわかる。 → 案1：比較した中で1番安い概算見積もりがわかる。案2：比較した中で1番安い概算見積もりが確認できる。（概算の明記がない）【参照：見積もり表記（「概算」の明記）】」"
    st, f = rp.parse_result(t)
    # ※「」内の「」はネスト。末尾 」 は外側
    assert st == rp.NG and f[0].kind == "fix"
    assert f[0].suggestions == ["比較した中で1番安い概算見積もりがわかる。", "比較した中で1番安い概算見積もりが確認できる。"]
    assert f[0].reason == "概算の明記がない"
    assert f[0].reference == "見積もり表記（「概算」の明記）"
    assert f[0].quote == "比較した中で1番安い見積もりがわかる。"


def test_alt_containing_mataha_not_split():
    t = "「電話ラッシュなし → 案1：数十社からの電話ラッシュなし案2：電話ラッシュなし※厳選3社からお電話またはメールはあります。（限定なく表現している）」"
    _, f = rp.parse_result(t)
    assert f[0].suggestions[1] == "電話ラッシュなし※厳選3社からお電話またはメールはあります。"
    assert f[0].reason == "限定なく表現している"


def test_legacy_format_kept_as_single_suggestion():
    t = "「電話ラッシュなし → 数十社からの電話ラッシュなしまたは電話ラッシュなし※厳選3社からお電話またはメールはあります。（限定なく表現している）」"
    _, f = rp.parse_result(t)
    assert len(f[0].suggestions) == 1 and "または" in f[0].suggestions[0]
    assert f[0].reason == "限定なく表現している" and f[0].reference == ""


def test_ok_error_confirm_and_mixed():
    assert rp.parse_result("問題なし") == (rp.OK, [])
    assert rp.parse_result("[APIエラー: timeout]")[0] == rp.ERROR
    assert rp.parse_result("[レスポンスなし|stop:x|blocks:[]]")[0] == rp.ERROR
    st, f = rp.parse_result("▼要確認：「最大10社」（根拠の確認が必要）")
    assert st == rp.CONFIRM and f[0].quote == "最大10社" and f[0].reason == "根拠の確認が必要"
    st, f = rp.parse_result("「あ → 案1：い案2：う（理由）」\n▼要確認：「え」（確認）")
    assert st == rp.NG and [x.kind for x in f] == ["fix", "confirm"]


def test_unparseable_is_raw_and_ng():
    st, f = rp.parse_result("これは想定外の出力です")
    assert st == rp.NG and f[0].kind == "raw" and f[0].raw == "これは想定外の出力です"
    assert rp.parse_result("")[0] == rp.ERROR
    assert rp.parse_result("[⚠️ 出力が上限に達しました]")[0] == rp.ERROR   # 本文なし
    st, f = rp.parse_result("「あ → 案1：い案2：う（理由）」\n[⚠️ 出力が上限に達しました]")
    assert st == rp.NG and len(f) == 1                                   # 警告行は指摘にしない


def test_highlight():
    assert rp.highlight("比較した中で1番安い見積もりがわかる。", "見積もり") == ("比較した中で1番安い", "見積もり", "がわかる。")
    assert rp.highlight("abc", "xyz") is None and rp.highlight("abc", "") is None
