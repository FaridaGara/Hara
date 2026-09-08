"""Transactional email transport; never include credentials or mail content in errors."""

from smtplib import SMTPException

import requests
from django.conf import settings
from django.core.mail import get_connection
from django.core.mail.backends.base import BaseEmailBackend


class EmailDeliveryError(Exception):
    pass


def ensure_email_delivery_configured():
    backend = settings.EMAIL_BACKEND
    if not settings.DEBUG and backend in {
        "django.core.mail.backends.console.EmailBackend",
        "django.core.mail.backends.filebased.EmailBackend",
        "django.core.mail.backends.dummy.EmailBackend",
    }:
        raise EmailDeliveryError("Non-delivering email backend in production.")
    if backend == "django.core.mail.backends.smtp.EmailBackend" and not settings.EMAIL_HOST.strip():
        raise EmailDeliveryError("Email host is missing.")
    if backend == "apps.users.email_delivery.ResendEmailBackend" and not settings.RESEND_API_KEY.strip():
        raise EmailDeliveryError("Email provider key is missing.")


class ResendEmailBackend(BaseEmailBackend):
    """Send HARA transactional messages through HTTPS, including Railway Hobby."""

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages or []:
            if not message.recipients():
                continue
            try:
                if not settings.RESEND_API_KEY.strip():
                    raise EmailDeliveryError("Email provider key is missing.")
                # Do not silently drop unsupported content from a future caller.
                if message.attachments or getattr(message, "alternatives", None):
                    raise EmailDeliveryError("Unsupported email content.")
                payload = {
                    "from": message.from_email,
                    "to": message.to,
                    "subject": message.subject,
                    "text": message.body,
                }
                for field in ("cc", "bcc", "reply_to"):
                    if getattr(message, field):
                        payload[field] = getattr(message, field)
                response = requests.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {settings.RESEND_API_KEY.strip()}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=(3, 7),
                    allow_redirects=False,
                )
                if not 200 <= response.status_code < 300:
                    raise EmailDeliveryError("Email provider rejected the message.")
                result = response.json()
                if not isinstance(result, dict) or not isinstance(result.get("id"), str) or not result["id"].strip():
                    raise EmailDeliveryError("Email provider did not acknowledge the message.")
                sent += 1
            except (requests.RequestException, ValueError, EmailDeliveryError):
                if not self.fail_silently:
                    raise EmailDeliveryError("Email delivery could not be confirmed.") from None
        return sent


def email_connection():
    ensure_email_delivery_configured()
    return get_connection(fail_silently=False)


# SMTP transports remain supported when explicitly configured on eligible hosts.
EMAIL_TRANSPORT_ERRORS = (SMTPException, OSError, EmailDeliveryError)
