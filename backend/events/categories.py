"""Compatibility for category slugs saved by the first event wizard."""
from .models import Category

LEGACY_SLUGS = {'musiqi': ('music',), 'teatr': ('theatre', 'theater'), 'idman': ('sports', 'sport')}


def resolve_category(slug):
    if not isinstance(slug, str):
        return None
    category = Category.objects.filter(slug=slug).first()
    # An explicitly disabled category must not be replaced with an alias.
    if category:
        return category if category.is_active else None
    for alias in LEGACY_SLUGS.get(slug, ()):
        category = Category.objects.filter(slug=alias, is_active=True).first()
        if category:
            return category
    return None
