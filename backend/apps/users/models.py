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
        account_type = extra_fields.setdefault(
            "account_type",
            self.model.AccountType.USER,
        )
        extra_fields.setdefault(
            "is_staff",
            account_type == self.model.AccountType.ADMIN,
        )
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("account_type", self.model.AccountType.ADMIN)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    class AccountType(models.TextChoices):
        USER = "user", "User"
        ORGANIZER = "organizer", "Organizer"
        ADMIN = "admin", "Admin"

    username = None
    email = models.EmailField(unique=True)
    account_type = models.CharField(
        max_length=16,
        choices=AccountType.choices,
        default=AccountType.USER,
    )
    display_name = models.CharField(max_length=150, blank=True)
    phone_number = models.CharField(max_length=32, blank=True)
    avatar_url = models.URLField(blank=True)
    birth_date = models.DateField(null=True, blank=True)
    interests = models.JSONField(default=list, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    @property
    def role(self):
        if self.is_superuser:
            return "superadmin"
        return self.account_type

    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.account_type = self.AccountType.ADMIN

        should_be_staff = (
            self.is_superuser
            or self.account_type == self.AccountType.ADMIN
        )
        self.is_staff = should_be_staff

        update_fields = kwargs.get("update_fields")
        if update_fields is not None:
            kwargs["update_fields"] = set(update_fields) | {
                "account_type",
                "is_staff",
            }

        super().save(*args, **kwargs)

    def __str__(self):
        return self.display_name or self.email


class SocialIdentity(models.Model):
    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        APPLE = "apple", "Apple"

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="social_identities",
    )
    provider = models.CharField(max_length=16, choices=Provider.choices)
    subject = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("provider", "subject"),
                name="unique_social_provider_subject",
            ),
        ]

    def __str__(self):
        return f"{self.provider}:{self.subject}"
