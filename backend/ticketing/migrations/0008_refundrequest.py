import uuid
import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('events', '0009_event_cancellation'),
        ('ticketing', '0007_tickettype_venue_section_and_more'),
    ]
    operations = [migrations.CreateModel(name='RefundRequest', fields=[
        ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
        ('amount', models.DecimalField(decimal_places=2, max_digits=10, validators=[django.core.validators.MinValueValidator(0)])),
        ('currency', models.CharField(default='AZN', max_length=3)),
        ('created_at', models.DateTimeField(auto_now_add=True)),
        ('event', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='refund_requests', to='events.event')),
        ('order', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='refund_requests', to='ticketing.order')),
    ], options={
        'ordering': ['created_at', 'id'],
        'constraints': [models.UniqueConstraint(fields=('event', 'order'), name='unique_event_order_refund_request')],
    })]
