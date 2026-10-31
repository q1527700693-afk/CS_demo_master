"""Only label recorded match timestamps as match time; never use export/file mtime."""
from datetime import datetime, timezone


def normalize_match_time(value):
    if value in (None, '', 0):
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            number = float(value)
            if number > 10**12:
                number /= 1000
            date = datetime.fromtimestamp(number, timezone.utc)
        else:
            date = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if date.tzinfo is None:
                return None
        if not 2000 <= date.year <= 2100:
            return None
        return date.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def recorded_match_time(header):
    for key in ('started_at', 'match_start_time', 'matchtime', 'match_time', 'utc_timestamp'):
        value = normalize_match_time((header or {}).get(key))
        if value:
            return value
    return None
