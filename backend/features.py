"""Feature extraction matching the final deployable model in ML_project (2).ipynb, cell 83."""
from __future__ import annotations
import math
from collections import Counter

FEATURE_ORDER = [
    'payload_len', 'url_len', 'param_count', 'special_char_count',
    'digit_count', 'encoded_char_count', 'path_depth', 'payload_entropy'
]
SPECIAL_CHARS = "'\"<>;%(){}[]"

def _shannon_entropy(text: str) -> float:
    if not text:
        return 0.0
    counts = Counter(text)
    length = len(text)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())

def extract_features(url: str = '', payload: str = '') -> dict[str, float]:
    url = '' if url is None else str(url)
    payload = '' if payload is None else str(payload)
    combined = url + payload
    return {
        'payload_len': len(payload),
        'url_len': len(url),
        'param_count': 0 if payload == '' else payload.count('&') + 1,
        'special_char_count': sum(combined.count(ch) for ch in SPECIAL_CHARS),
        'digit_count': sum(ch.isdigit() for ch in combined),
        'encoded_char_count': combined.count('%'),
        'path_depth': url.count('/'),
        'payload_entropy': _shannon_entropy(payload),
    }

def features_to_row(feature_values: dict[str, float], expected_order: list[str] | None = None) -> list[float]:
    order = expected_order or FEATURE_ORDER
    missing = [name for name in order if name not in feature_values]
    if missing:
        raise ValueError(f'Missing features: {missing}')
    return [float(feature_values[name]) for name in order]
