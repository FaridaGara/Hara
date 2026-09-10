"""Atomic review decisions shared by the team API and Django admin."""
import hashlib
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError
from .models import Event, EventSubmission, SubmissionReviewLog, VenuePlan
from .submissions import eligibility, is_free_event, validate_snapshot
from .cancellations import cancel_event


class ReviewConflict(APIException):
    status_code = 409
    default_detail = 'Tədbir və ya yoxlama dəyişib. Son məlumatları yüklə və yenidən bax.'


def review_version(item):
    value = f'{item.fingerprint}:{item.status}:{item.updated_at.isoformat()}:{item.event.updated_at.isoformat()}'
    return hashlib.sha256(value.encode()).hexdigest()


@transaction.atomic
def review_submission(pk, reviewer, *, action, body, request_id, version=None):
    owner_id = get_object_or_404(EventSubmission.objects.only('owner_id'), pk=pk).owner_id
    # Same lock order as organizer resubmission: owner, submission, event.
    # Keep profile edits serialized, but allow FK key-share locks when the
    # creator also buys tickets while a team decision waits for the event.
    owner = get_user_model().objects.select_for_update(no_key=True).get(pk=owner_id)
    item = EventSubmission.objects.select_for_update().get(pk=pk)
    event = Event.objects.select_for_update().select_related('venue').get(pk=item.event_id)
    item.owner, item.event = owner, event
    previous = SubmissionReviewLog.objects.filter(pk=request_id).first()
    if previous:
        if (previous.submission_id, previous.author_id, previous.action, previous.body) != (item.pk, reviewer.pk, action, body):
            raise ReviewConflict('Bu sorğu artıq başqa əməliyyat üçün istifadə olunub.')
        return item
    if version is not None and version != review_version(item):
        raise ReviewConflict()
    if action not in SubmissionReviewLog.Action.values or len(body) > 2000:
        raise ValidationError({'detail': 'Yoxlama əməliyyatı düzgün deyil.'})
    if action != 'approved' and not body.strip():
        raise ValidationError({'detail': 'Şərhi yaz.'})
    if action == 'cancelled':
        if event.status != 'published':
            raise ReviewConflict('Yalnız yayımlanmış tədbir dayandırıla bilər.')
        event = cancel_event(event_id=event.pk, author=reviewer, reason=body)
        item.event, item.note = event, body
    elif action != 'comment':
        if event.status != 'draft' or item.status != 'pending':
            raise ReviewConflict('Yalnız yoxlanılan tədbir barədə qərar verilə bilər.')
        if action == 'changes_requested':
            item.status, item.note = 'changes_requested', body
        else:
            gate = eligibility(owner, free_event=is_free_event(item.snapshot) and not event.ticket_types.exclude(price=0).exists())
            if not gate['eligible']:
                raise ValidationError({'detail': gate['detail']})
            validate_snapshot(item.snapshot)
            if event.venue_plan_id:
                VenuePlan.objects.filter(pk=event.venue_plan_id).update(status='published')
            event.venue.is_active = True
            event.venue.save(update_fields=['is_active'])
            event.status = 'published'
            try:
                event.full_clean()
            except DjangoValidationError as error:
                raise ValidationError({'detail': ' '.join(error.messages)}) from error
            event.save(update_fields=['status', 'published_at', 'updated_at'])
            item.note = ''
    item.save(update_fields=['status', 'note', 'updated_at'])
    SubmissionReviewLog.objects.create(id=request_id, submission=item, author=reviewer, action=action, body=body)
    return item
