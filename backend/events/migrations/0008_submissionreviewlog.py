import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('events', '0007_eventsubmission'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [migrations.CreateModel(
        name='SubmissionReviewLog',
        fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('action', models.CharField(choices=[('comment', 'Daxili şərh'), ('changes_requested', 'Düzəliş tələb edildi'), ('approved', 'Təsdiqləndi və yayımlandı')], max_length=24)),
            ('body', models.TextField(blank=True, max_length=2000)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='submission_review_logs', to=settings.AUTH_USER_MODEL)),
            ('submission', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='review_logs', to='events.eventsubmission')),
        ],
        options={'ordering': ['-created_at', '-id']},
    )]
