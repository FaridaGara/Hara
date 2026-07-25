from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.validators import validate_email
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")

        email = self.normalize_email(email).casefold()
        validate_email(email)

        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    class AccountType(models.TextChoices):
        ATTENDEE = "attendee", "Attendee"
        ORGANIZER = "organizer", "Organizer"

    username = None
    email = models.EmailField(unique=True)
    account_type = models.CharField(
        max_length=16,
        choices=AccountType.choices,
        default=AccountType.ATTENDEE,
    )
    display_name = models.CharField(max_length=150, blank=True)
    phone_number = models.CharField(max_length=32, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.display_name or self.email
