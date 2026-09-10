"""Compact previews for authenticated event and ticket responses."""
import base64
import io
from functools import lru_cache
from PIL import Image


@lru_cache(maxsize=128)
def cover_thumbnail(cover, width=144, height=176):
    """Small private previews, without returning the complete media snapshot in lists."""
    if not isinstance(cover, str) or len(cover) > 250_000 or not cover.startswith('data:image/jpeg;base64,'):
        return ''
    try:
        with Image.open(io.BytesIO(base64.b64decode(cover.split(',', 1)[1], validate=True))) as image:
            if image.width * image.height > 4_000_000:
                return ''
            image.thumbnail((width, height))
            buffer = io.BytesIO()
            image.convert('RGB').save(buffer, format='JPEG', quality=70)
            return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()
    except (ValueError, OSError):
        return ''

