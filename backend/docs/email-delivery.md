# Transactional email delivery

Production previously defaulted to Django's console email backend. With no mail
variables configured, verification requests reported success while printing mail
to application logs. Production now defaults to the Resend HTTPS backend; console
delivery remains a local DEBUG default. Explicit console, file and dummy backends
are rejected by verification flows when DEBUG is false.

## Enable delivery on Railway

1. Use a Resend account on the Free plan. Verify an owned sending domain in its
   dashboard using the exact DNS records it provides. Do not invent DNS values or
   overwrite unrelated mail records.
2. Create a sending API key scoped to that domain. Enter the key directly into the
   Railway Hara service's production Variables panel; never commit or paste it
   into a ticket, chat or logs.
3. Configure and deploy these variables:

   ```dotenv
   DJANGO_DEBUG=false
   EMAIL_BACKEND=apps.users.email_delivery.ResendEmailBackend
   RESEND_API_KEY=<private sending key>
   DEFAULT_FROM_EMAIL=HARA <no-reply@hara.today>
   ```

   The From address must use the domain actually verified in Resend. If a sending
   subdomain was verified, change the address to that subdomain.
4. With the recipient's permission, request a fresh verification code and check
   inbox/spam plus the provider's delivery status. Provider acceptance is not
   evidence of inbox delivery. Never copy verification codes from server logs.

Code deployment alone does not enable delivery: the provider key and verified
domain must also be configured. Existing unverified accounts can request a fresh
registration code after setup; no data deletion or migration is required.

Railway limits outbound SMTP to Pro and above. This integration uses HTTPS and
does not require that upgrade. Resend Free currently includes 3,000 transactional
emails per month, capped at 100 per day. Stay on the free plan; reaching its limits
can prevent sending. No automatic paid upgrade or alternative paid transport is
implemented. Official references, checked 2026-09-08:

- [Railway outbound networking](https://docs.railway.com/networking/outbound-networking)
- [Resend pricing](https://resend.com/pricing)
- [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)
- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)

## Failure behavior and checks

- Registration, resend and reset-request return HTTP 503 with
  `code=email_delivery_unavailable` when configuration is missing or sending fails.
  A provider response must be 2xx with a nonempty message ID; zero sent messages,
  redirects, malformed responses, timeouts and provider errors are failures.
- Reset/resend configuration is checked before account lookup, so missing
  configuration returns the same response for known and unknown addresses.
- Registration rolls back new accounts/codes on failure. Failed resends preserve
  the previous challenge. Existing IP/email abuse limits still count attempts.
- HTTPS has bounded connect/read timeouts, no redirects and no automatic retries.
  Errors do not expose message content, keys or provider diagnostic bodies.
- A timeout can occur after provider acceptance. Such a request reports failure;
  its transaction rolls back, so an ambiguously delivered new code cannot be used.
- `python manage.py test apps.users.test_email_delivery` uses mocked HTTPS only.
  The Django test runner's locmem backend remains usable by other tests.
- SMTP is still available through an explicit EMAIL_BACKEND on compatible hosts.
  Its timeout is 10 seconds; SMTP/connection errors use the same safe API response.
