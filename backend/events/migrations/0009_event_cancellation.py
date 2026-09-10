from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('events', '0008_submissionreviewlog'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(name='EventCancellation', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('reason', models.TextField(max_length=2000)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('author', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='event_cancellations', to=settings.AUTH_USER_MODEL)),
            ('event', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name='cancellation', to='events.event')),
        ]),
        migrations.AlterField(model_name='notification', name='type', field=models.CharField(max_length=64, choices=[
            ('event_cancelled', 'Tədbir ləğv edildi'), ('refund_pending', 'Geri ödəniş gözlənilir'),
            ('organizer_event_published', 'Organizer event published'),
        ])),
        migrations.AlterField(model_name='submissionreviewlog', name='action', field=models.CharField(max_length=24, choices=[
            ('comment', 'Daxili şərh'), ('changes_requested', 'Düzəliş tələb edildi'),
            ('approved', 'Təsdiqləndi və yayımlandı'), ('cancelled', 'Tədbir dayandırıldı'),
        ])),
    ]
