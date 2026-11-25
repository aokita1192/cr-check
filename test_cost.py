"""Unit tests for calc_cost_usd."""

INPUT_PRICE_PER_1M_USD          = 2.00
OUTPUT_PRICE_PER_1M_USD         = 10.00
CACHE_WRITE_5M_PRICE_PER_1M_USD = 2.50
CACHE_WRITE_1H_PRICE_PER_1M_USD = 4.00
CACHE_READ_PRICE_PER_1M_USD     = 0.20


def calc_cost_usd(
    input_tokens: int,
    output_tokens: int,
    cache_write_5m: int = 0,
    cache_write_1h: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    return (
        input_tokens        * INPUT_PRICE_PER_1M_USD
        + output_tokens     * OUTPUT_PRICE_PER_1M_USD
        + cache_write_5m    * CACHE_WRITE_5M_PRICE_PER_1M_USD
        + cache_write_1h    * CACHE_WRITE_1H_PRICE_PER_1M_USD
        + cache_read_tokens * CACHE_READ_PRICE_PER_1M_USD
    ) / 1_000_000


def test_basic():
    """No cache: 7478 input, 8507 output."""
    cost = calc_cost_usd(7478, 8507)
    expected = (7478 * 2.00 + 8507 * 10.00) / 1_000_000
    assert abs(cost - expected) < 1e-9, f"Expected {expected}, got {cost}"


def test_with_cache_write_5m():
    """Case from requirements: input 7478, output 8507, cache_write_5m 10_000_000 → ~$25.10"""
    cost = calc_cost_usd(7478, 8507, cache_write_5m=10_000_000)
    # 2.00*0.007478 + 10.00*0.008507 + 2.50*10 = 0.014956 + 0.08507 + 25.0 = 25.100026
    expected = (7478 * 2.00 + 8507 * 10.00 + 10_000_000 * 2.50) / 1_000_000
    assert abs(cost - expected) < 1e-6, f"Expected {expected}, got {cost}"
    assert 25.09 < cost < 25.11, f"Expected ~$25.10, got {cost}"


def test_cache_write_1h():
    """1-hour cache write pricing ($4.00/1M)."""
    cost = calc_cost_usd(0, 0, cache_write_1h=1_000_000)
    expected = 4.00
    assert abs(cost - expected) < 1e-9, f"Expected {expected}, got {cost}"


def test_cache_read():
    """Cache read pricing ($0.20/1M)."""
    cost = calc_cost_usd(0, 0, cache_read_tokens=1_000_000)
    expected = 0.20
    assert abs(cost - expected) < 1e-9, f"Expected {expected}, got {cost}"


def test_all_components():
    """All components together."""
    cost = calc_cost_usd(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_write_5m=1_000_000,
        cache_write_1h=1_000_000,
        cache_read_tokens=1_000_000,
    )
    expected = (2.00 + 10.00 + 2.50 + 4.00 + 0.20)
    assert abs(cost - expected) < 1e-9, f"Expected {expected}, got {cost}"


if __name__ == "__main__":
    test_basic()
    test_with_cache_write_5m()
    test_cache_write_1h()
    test_cache_read()
    test_all_components()
    print("All tests passed.")
