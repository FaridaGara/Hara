from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("users", "0006_authsession")]
    operations = [
        migrations.AddField(model_name="user", name="organizer_name", field=models.CharField(blank=True, max_length=150)),
        migrations.AddField(model_name="user", name="organizer_description", field=models.CharField(blank=True, max_length=1000)),
        migrations.AddField(model_name="user", name="organizer_website", field=models.URLField(blank=True, max_length=500)),
        migrations.AddField(model_name="user", name="tax_id", field=models.CharField(blank=True, max_length=10)),
        migrations.AddField(model_name="user", name="tax_legal_name", field=models.CharField(blank=True, max_length=255)),
    ]
