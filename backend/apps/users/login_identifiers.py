import re

from .models import User


def normalize_phone(value):
    return re.sub(r"[\s()\-]", "", value.strip())


def find_login_user(identifier):
    identifier = identifier.strip()
    if "@" in identifier:
        return User.objects.filter(email=identifier.casefold()).first()
    users = list(User.objects.filter(
        phone_number=normalize_phone(identifier), is_active=True,
    )[:2])
    return users[0] if len(users) == 1 else None
