from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('events', '0006_seatinglayouttemplate'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [migrations.CreateModel(
        name='EventSubmission',
        fields=[
            ('id', models.UUIDField(editable=False, primary_key=True, serialize=False)),
            ('snapshot', models.JSONField()),
            ('fingerprint', models.CharField(max_length=64)),
            ('status', models.CharField(choices=[('pending', 'Yoxlanılır'), ('changes_requested', 'Düzəliş tələb olunur')], default='pending', max_length=24)),
            ('note', models.TextField(blank=True, max_length=2000)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('updated_at', models.DateTimeField(auto_now=True)),
            ('owner', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='event_submissions', to=settings.AUTH_USER_MODEL)),
            ('event', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name='submission', to='events.event')),
        ],
        options={'ordering': ['-created_at']},
    )]
