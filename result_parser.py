"""AI審査結果テキストの構造化（Streamlit非依存・テスト可能）。

出力形式（プロンプト v6）
  形式1: 「引用 → 案1：…案2：…（理由）【参照：項目名】」   ※参照は省略可
  形式2: ▼要確認：（原文引用）（確認内容）
  OK   : 問題なし
旧形式（「引用 → 案Aまたは案B（理由）」）は、案の中に「または」を含みうるため分割せず、
全体を1案として扱う。解析できない行は kind="raw" として原文のまま保持する。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

OK, NG, CONFIRM, ERROR = "ok", "ng", "confirm", "error"

_REF_RE = re.compile(r"【参照[:：]\s*([^】]*)】\s*$")
_REASON_RE = re.compile(r"[（(]([^（）()]*)[）)]\s*$")
_ALT_RE = re.compile(r"案1[:：]\s*(.*?)\s*案2[:：]\s*(.*)$", re.S)


@dataclass
class Finding:
    kind: str                      # "fix" | "confirm" | "raw"
    quote: str = ""
    suggestions: list[str] = field(default_factory=list)
    reason: str = ""
    reference: str = ""
    raw: str = ""


def is_ok(text: str) -> bool:
    return text.strip().startswith("問題なし")


def is_error(text: str) -> bool:
    t = text.strip()
    return t.startswith("[APIエラー") or t.startswith("[レスポンスなし")


def parse_line(line: str) -> Finding:
    s = line.strip()
    if s.startswith("▼要確認"):
        body = s.split("：", 1)[1].strip() if "：" in s else s
        m = re.match(r"^「?(.*?)」?\s*[（(](.*)[）)]\s*$", body, re.S)
        if m:
            return Finding("confirm", quote=m.group(1).strip(), reason=m.group(2).strip(), raw=s)
        return Finding("confirm", reason=body, raw=s)

    if not (s.startswith("「") and s.endswith("」")):
        return Finding("raw", raw=s)
    inner = s[1:-1]
    if " → " not in inner:
        return Finding("raw", raw=s)
    quote, rest = inner.split(" → ", 1)
    rest = rest.strip()

    ref = ""
    m = _REF_RE.search(rest)
    if m:
        ref = m.group(1).strip()
        rest = rest[: m.start()].rstrip()

    reason = ""
    m = _REASON_RE.search(rest)
    if m:
        reason = m.group(1).strip()
        rest = rest[: m.start()].rstrip()

    m = _ALT_RE.match(rest)
    if m:
        sugg = [m.group(1).strip(), m.group(2).strip()]
    else:
        sugg = [rest] if rest else []   # 旧形式は分割しない
    return Finding("fix", quote=quote.strip(), suggestions=[x for x in sugg if x], reason=reason,
                   reference=ref, raw=s)


def parse_result(text: str) -> tuple[str, list[Finding]]:
    """(status, findings)。status: ok / ng / confirm / error。"""
    if is_ok(text):
        return OK, []
    if is_error(text):
        return ERROR, []
    findings = [parse_line(l) for l in text.splitlines() if l.strip() and not l.strip().startswith("[⚠️")]
    if not findings:
        return ERROR, []
    # 「要修正」は fix と解析不能(raw)を含む。▼要確認のみなら CONFIRM。
    if all(f.kind == "confirm" for f in findings):
        return CONFIRM, findings
    return NG, findings


def highlight(serif: str, quote: str) -> tuple[str, str, str] | None:
    """セリフ中の引用位置で3分割。引用が原文に無ければ None（呼び出し側で全文表示）。"""
    if not quote:
        return None
    i = serif.find(quote)
    if i < 0:
        return None
    return serif[:i], quote, serif[i + len(quote):]
