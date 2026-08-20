import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def mark_existing_users_verified(apps, schema_editor):
    User = apps.get_model("users", "User")
    User.objects.filter(is_active=True).update(is_email_verified=True)


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0003_alter_user_account_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="is_email_verified",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(
            mark_existing_users_verified,
            migrations.RunPython.noop,
        ),
        migrations.CreateModel(
            name="VerificationCode",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("purpose", models.CharField(
                    choices=[
                        ("registration", "Registration"),
                        ("password_reset", "Password reset"),
                    ],
                    max_length=24,
                )),
                ("code_hash", models.CharField(max_length=128)),
                ("expires_at", models.DateTimeField()),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("verified_at", models.DateTimeField(blank=True, null=True)),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="verification_codes",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ("-created_at",)},
        ),
        migrations.AddIndex(
            model_name="verificationcode",
            index=models.Index(
                fields=["user", "purpose", "consumed_at"],
                name="users_code_lookup_idx",
            ),
        ),
    ]
