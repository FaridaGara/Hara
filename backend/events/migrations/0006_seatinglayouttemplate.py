import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('events', '0005_eventphoto_organizerfollow_notification'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [migrations.CreateModel(
        name='SeatingLayoutTemplate',
        fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('venue_key', models.CharField(max_length=750)),
            ('name', models.CharField(max_length=160)),
            ('layout', models.JSONField()),
            ('seat_count', models.PositiveIntegerField()),
            ('blocked_count', models.PositiveIntegerField()),
            ('updated_at', models.DateTimeField(auto_now=True)),
            ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='seating_layouts', to=settings.AUTH_USER_MODEL)),
        ],
        options={'ordering': ['-updated_at'], 'indexes': [models.Index(fields=['owner', 'venue_key'], name='seat_layout_owner_venue_idx')]},
    )]
