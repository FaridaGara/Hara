"""Review submission; public visibility remains controlled by staff moderation."""
import base64
import copy
import hashlib
import io
import json
import math
import re
from collections import Counter
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.contrib.gis.geos import Point
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .models import Event, EventPhoto, EventSubmission, Venue, VenuePlan, VenueSection, VenueSeat
from .categories import resolve_category
from .seat_plans import number, text, validate_layout
from ticketing.models import TicketType


class SubmissionThrottle(UserRateThrottle):
    rate = '30/hour'
    scope = 'event_submission'


def is_free_event(snapshot):
    """Fail closed for malformed or mixed-price drafts; the full validator still runs."""
    sales = snapshot.get('sales') if isinstance(snapshot, dict) else None
    tickets = sales.get('tickets') if isinstance(sales, dict) else None
    return isinstance(tickets, list) and bool(tickets) and all(
        isinstance(ticket, dict) and ticket.get('paymentType') == 'free' for ticket in tickets
    )


def eligibility(user, *, free_event=False):
    if not user.is_active or not user.is_email_verified:
        return {'eligible': False, 'detail': 'Əvvəlcə e-poçt ünvanını təsdiqlə.'}
    if not free_event and not user.is_superuser and user.account_type != 'organizer':
        return {'eligible': False, 'detail': 'Ödənişli tədbir göndərmək üçün HARA tərəfindən verilmiş təşkilatçı hesabı lazımdır. Qaralamanı saxlaya bilərsən.'}
    if not (user.display_name or user.get_full_name()).strip() or not user.phone_number.strip():
        return {'eligible': False, 'detail': 'Profilində ad və əlaqə nömrəsini tamamla.'}
    return {'eligible': True, 'detail': 'Tədbiri yoxlamaya göndərə bilərsən.'}


def invalid(message):
    raise serializers.ValidationError({'detail': message})


def moment(date, time):
    try:
        if not isinstance(date, str) or not isinstance(time, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date) or not re.fullmatch(r'\d{2}:\d{2}', time):
            raise ValueError()
        return datetime.strptime(f'{date}T{time}', '%Y-%m-%dT%H:%M').replace(tzinfo=dt_timezone(timedelta(hours=4)))
    except (ValueError, TypeError):
        invalid('Tarix və saat düzgün deyil.')


def integer(value, maximum=1_000_000):
    if not isinstance(value, str) or not re.fullmatch(r'\d{1,7}', value) or not 1 <= int(value) <= maximum:
        invalid('Say müsbət tam ədəd olmalıdır.')
    return int(value)


def validate_photo(value):
    if not isinstance(value, str) or len(value) > 250_000 or not re.fullmatch(r'data:image/jpeg;base64,[A-Za-z0-9+/=]+', value):
        invalid('Şəkli yenidən yüklə.')
    try:
        image = Image.open(io.BytesIO(base64.b64decode(value.split(',')[1], validate=True)))
        if image.format != 'JPEG' or image.width * image.height > 4_000_000:
            invalid('Şəkil ölçüsü düzgün deyil.')
        image.verify()
    except serializers.ValidationError:
        raise
    except Exception:
        invalid('Şəkil açıla bilmir.')


def transformed_seats(layout):
    for block_index, block in enumerate(layout['blocks'], 1):
        angle = math.radians(block['rotation'])
        for seat in block['seats']:
            local_x, local_y = seat['x'] * block['scale'], seat['y'] * block['scale']
            x = block['x'] + local_x * math.cos(angle) - local_y * math.sin(angle)
            y = block['y'] + local_x * math.sin(angle) + local_y * math.cos(angle)
            yield block_index, seat, x, y


def validate_snapshot(value):
    if not isinstance(value, dict) or len(json.dumps(value)) > 3_800_000:
        invalid('Tədbir məlumatı düzgün deyil və ya çox böyükdür.')
    data = copy.deepcopy(value)
    for key, limit in [('title', 255), ('description', 1000)]:
        if not text(data.get(key), limit): invalid('Əsas məlumatları tamamla.')
    if data.get('age', '') not in ('', '0+', '6+', '12+', '16+', '18+') or data.get('language', '') not in ('', 'az', 'en', 'ru', 'tr'):
        invalid('Yaş və ya dil seçimi düzgün deyil.')
    if data.get('duration') and (not isinstance(data['duration'], str) or not re.fullmatch(r'\d{1,5}', data['duration']) or int(data['duration']) < 1):
        invalid('Müddət düzgün deyil.')
    category = resolve_category(data.get('category'))
    if not category:
        raise serializers.ValidationError({'detail': 'Bu kateqoriya artıq mövcud deyil. Əsas məlumatlarda siyahıdan yenidən seç.', 'code': 'CATEGORY_UNAVAILABLE'})
    data['category'] = category.slug
    data['categoryLabel'] = category.name
    schedule, sales, media = (data.get(key) for key in ('schedule', 'sales', 'media'))
    if not all(isinstance(part, dict) for part in (schedule, sales, media)): invalid('Məlumatları tamamla.')
    start = moment(schedule.get('startDate'), schedule.get('startTime'))
    end = moment(schedule.get('endDate'), schedule.get('endTime'))
    now = timezone.now()
    if start <= now or end <= start: invalid('Başlanğıc gələcəkdə, bitmə isə başlanğıcdan sonra olmalıdır.')
    venue_data = schedule.get('venue')
    if not isinstance(venue_data, dict): invalid('Məkanı seç.')
    venue = None
    capacity = integer(sales.get('capacity')) if sales.get('capacity') else None
    if venue_data.get('source') == 'catalog':
        try: venue = Venue.objects.filter(pk=venue_data.get('id'), is_active=True).first()
        except (ValueError, TypeError, DjangoValidationError):
            invalid('Məkan tapılmadı.')
        if not venue: invalid('Məkan tapılmadı.')
        plan = venue.plans.filter(status='published').order_by('-is_default', '-version').first()
        if plan:
            actual = sum(section.capacity for section in plan.sections.filter(is_active=True))
            if actual: capacity = actual
        schedule['venue'].update(name=venue.name, address=venue.address, city=venue.city, latitude=venue.location.y, longitude=venue.location.x, capacity=capacity)
    elif venue_data.get('source') == 'manual':
        if not text(venue_data.get('name'), 200) or not text(venue_data.get('address'), 300) or not number(venue_data.get('latitude'), -90, 90) or not number(venue_data.get('longitude'), -180, 180):
            invalid('Məkanın adını, ünvanını və xəritədə girişini tamamla.')
        if venue_data.get('id') is not None: invalid('Əl ilə daxil edilən məkan düzgün deyil.')
    else: invalid('Məkanı seç.')
    if not text(venue_data.get('entry_note', ''), 300, True): invalid('Giriş qeydi çox uzundur.')
    if not capacity: invalid('Məkan tutumunu daxil et.')
    if sales.get('admissionType') not in ('general', 'seated'): invalid('Giriş növünü seç.')
    tickets = sales.get('tickets')
    if not isinstance(tickets, list) or not 1 <= len(tickets) <= 20: invalid('Bilet növlərini tamamla.')
    ids = set()
    for ticket in tickets:
        if not isinstance(ticket, dict) or not text(ticket.get('id'), 100) or ticket['id'] in ids or not text(ticket.get('name'), 80) or not text(ticket.get('includes', ''), 200, True): invalid('Bilet məlumatları düzgün deyil.')
        ids.add(ticket['id'])
        integer(ticket.get('quantity'))
        if ticket.get('paymentType') not in ('paid', 'free'): invalid('Biletin ödəniş növünü seç.')
        if ticket['paymentType'] == 'paid' and (not isinstance(ticket.get('price'), str) or not re.fullmatch(r'\d{1,7}(\.\d{1,2})?', ticket['price']) or Decimal(ticket['price']) <= 0): invalid('Bilet qiymətini daxil et.')
    if sum(int(t['quantity']) for t in tickets) > capacity: invalid('Bilet sayı məkan tutumunu keçir.')
    minimum, maximum = integer(sales.get('minPerOrder'), 99), integer(sales.get('maxPerOrder'), 99)
    if minimum > maximum or minimum > sum(int(t['quantity']) for t in tickets): invalid('Sifariş limitləri düzgün deyil.')
    if sales.get('refundPolicy', '') not in ('', 'non_refundable', 'until_24h', 'until_72h'): invalid('Geri qaytarılma qaydası düzgün deyil.')
    if any(t['paymentType'] == 'paid' for t in tickets) and not sales.get('refundPolicy'): invalid('Geri qaytarılma qaydasını seç.')
    if sales.get('salesStart') not in ('published', 'custom') or sales.get('salesEnd') not in ('event_start', 'custom'): invalid('Satış vaxtını seç.')
    sales_start = moment(sales.get('salesStartDate'), sales.get('salesStartTime')) if sales['salesStart'] == 'custom' else None
    sales_end = moment(sales.get('salesEndDate'), sales.get('salesEndTime')) if sales['salesEnd'] == 'custom' else start
    if sales_end > start or sales_end <= now or (sales_start and sales_start >= sales_end): invalid('Satış vaxtları düzgün deyil.')
    if sales['admissionType'] == 'seated':
        layout = sales.get('seatPlan')
        total, blocked = validate_layout(layout)
        if any(not (0 <= x <= 1000 and 0 <= y <= 650) for _, _, x, y in transformed_seats(layout)):
            invalid('Oturacaq bloklarını planın görünən sahəsinə yerləşdir.')
        expected_key = f'catalog:{venue.pk}' if venue else 'manual:' + '|'.join([venue_data['name'].strip().lower(), venue_data['address'].strip().lower(), str(venue_data['latitude']).removesuffix('.0'), str(venue_data['longitude']).removesuffix('.0')])
        if sales.get('seatPlanApplied') is not True or layout['venueKey'] != expected_key or total > capacity: invalid('Oturacaq planı məkanla uyğun deyil.')
        counts = Counter(s['categoryId'] for b in layout['blocks'] for s in b['seats'] if not s['blocked'])
        expected = {c['id']: c for c in layout['categories'] if counts[c['id']]}
        if set(expected) != ids: invalid('Bilet növləri plan kateqoriyaları ilə uyğun deyil.')
        for ticket in tickets:
            category_data = expected[ticket['id']]
            if int(ticket['quantity']) != counts[ticket['id']] or ticket['name'] != category_data['name'] or (ticket['paymentType'] == 'free') != category_data['free'] or (not category_data['free'] and Decimal(ticket['price']) != Decimal(category_data['price'])): invalid('Plan qiyməti və bilet sayı uyğun deyil.')
        layout.pop('editorDraft', None)
    validate_photo(media.get('cover'))
    if not isinstance(media.get('gallery'), list) or len(media['gallery']) > 4: invalid('Maksimum 4 əlavə şəkil seç.')
    for photo in media['gallery']: validate_photo(photo)
    data.pop('submissionId', None)
    return data, category, venue, start, end, sales_start, sales_end


def materialize_event(request, pk, validated, existing=None):
    data, category, venue, start, end, sales_start, sales_end = validated
    sales = data['sales']
    if not venue:
        v = data['schedule']['venue']
        venue = Venue.objects.create(name=v['name'], address=v['address'], city=v.get('city') or 'Bakı', location=Point(v['longitude'], v['latitude']), created_by=request.user, is_active=False)
    cover = request.build_absolute_uri(reverse('submission-image', args=[pk, 0]))
    event = existing or Event(organizer=request.user)
    for key, value in dict(title=data['title'], category=category, venue=venue, venue_plan=None, description=data['description'], cover_image_url=cover, start_at=start, end_at=end, status=Event.Status.DRAFT).items(): setattr(event, key, value)
    event.save()
    if existing: event.ticket_types.all().delete(); event.photos.all().delete()
    sections = {}
    if sales['admissionType'] == 'seated':
        layout = sales['seatPlan']
        background = layout['background']
        background_url = request.build_absolute_uri(reverse('submission-image', args=[pk, 5])) if background.startswith('data:') else background
        plan = VenuePlan.objects.create(venue=venue, name=layout['name'], background_image_url=background_url, canvas_width=1000, canvas_height=650, status='draft')
        # Keep original block geometry in the immutable submission. Each price category
        # receives its own inventory section; row labels include the block number.
        positions = list(transformed_seats(layout))
        for cat in layout['categories']:
            entries = [entry for entry in positions if entry[1].get('categoryId') == cat['id']]
            if not entries: continue
            section = VenueSection.objects.create(venue_plan=plan, code=f'category-{len(sections)+1}', name=cat['name'], seating_type='reserved_seating', capacity=len(entries))
            sections[cat['id']] = section
            seats = [VenueSeat(section=section, row_label=f"{block_index}:{seat['row']}", seat_number=str(seat['number']), x=Decimal(str(x)), y=Decimal(str(y)), is_active=not seat['blocked']) for block_index, seat, x, y in entries]
            VenueSeat.objects.bulk_create(seats)
        unassigned = [entry for entry in positions if not entry[1].get('categoryId')]
        if unassigned:
            section = VenueSection.objects.create(venue_plan=plan, code='unavailable', name='Satışa bağlı yerlər', seating_type='reserved_seating', capacity=len(unassigned))
            VenueSeat.objects.bulk_create([VenueSeat(section=section, row_label=f"{block_index}:{seat['row']}", seat_number=str(seat['number']), x=Decimal(str(x)), y=Decimal(str(y)), is_active=False) for block_index, seat, x, y in unassigned])
        event.venue_plan = plan; event.save(update_fields=['venue_plan'])
    TicketType.objects.bulk_create([TicketType(event=event, name=t['name'], venue_section=sections.get(t['id']), price=Decimal(t['price']) if t['paymentType']=='paid' else Decimal('0'), capacity=int(t['quantity']), max_per_order=min(int(sales['maxPerOrder']), int(t['quantity'])), sales_start_at=sales_start, sales_end_at=sales_end) for t in sales['tickets']])
    for index, _ in enumerate(data['media']['gallery'], 1):
        EventPhoto.objects.create(event=event, image_url=request.build_absolute_uri(reverse('submission-image', args=[pk, index])), sort_order=index-1)
    return event


def output(item, detail=False):
    public_status = item.event.status
    result = {'id': str(item.pk), 'title': item.event.title, 'status': public_status if public_status != 'draft' else item.status, 'note': item.note, 'event_slug': item.event.slug, 'sales_start_at': item.event.ticket_types.order_by('sales_start_at').values_list('sales_start_at', flat=True).first()}
    result.update(submitted_at=item.created_at, updated_at=max(item.updated_at, item.event.updated_at))
    if detail: result['snapshot'] = item.snapshot
    return result


class SubmissionEligibilityAPIView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request): return Response(eligibility(request.user, free_event=request.query_params.get('payment_type') == 'free'))


class SubmissionListAPIView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        return Response([output(item) for item in EventSubmission.objects.filter(owner=request.user).select_related('event')[:100]])


class SubmissionDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [SubmissionThrottle]
    def get(self, request, pk):
        return Response(output(get_object_or_404(EventSubmission.objects.select_related('event'), pk=pk, owner=request.user), True))

    @transaction.atomic
    def put(self, request, pk):
        # Lock the owner row too: concurrent first submissions have no existing row to lock.
        owner = request.user.__class__.objects.select_for_update().get(pk=request.user.pk)
        item = EventSubmission.objects.select_for_update().select_related('event').filter(pk=pk).first()
        if item and item.owner_id != owner.pk: return Response(status=404)
        raw = request.data.get('snapshot') if isinstance(request.data, dict) else None
        fingerprint = hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if item and item.fingerprint == fingerprint: return Response(output(item, True))
        if item and (item.status != 'changes_requested' or item.event.status != 'draft' or item.event.tickets.exists()): return Response({'detail': 'Əvvəlki sorğu artıq göndərilib. Statusu yoxla.'}, status=409)
        gate = eligibility(owner, free_event=is_free_event(raw))
        if not gate['eligible']: return Response({'detail': gate['detail']}, status=403)
        if not item and EventSubmission.objects.filter(owner=owner).count() >= 100: invalid('Maksimum 100 tədbir göndərə bilərsən.')
        created = item is None
        validated = validate_snapshot(raw)
        event = materialize_event(request, pk, validated, item.event if item else None)
        item, _ = EventSubmission.objects.update_or_create(pk=pk, defaults={'owner': owner, 'event': event, 'snapshot': validated[0], 'fingerprint': fingerprint, 'status': 'pending', 'note': ''})
        return Response(output(item, True), status=201 if created else 200)


class SubmissionImageAPIView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    def get(self, request, pk, index):
        # Draft media is available only inside the authenticated snapshot; this endpoint
        # becomes readable after staff publishes the associated event.
        item = get_object_or_404(EventSubmission.objects.select_related('event'), pk=pk, event__status='published')
        images = [item.snapshot['media']['cover'], *item.snapshot['media']['gallery']]
        if index == 5:
            photo = (item.snapshot['sales'].get('seatPlan') or {}).get('background', '')
            if not photo.startswith('data:'): return Response(status=404)
        elif index < len(images): photo = images[index]
        else: return Response(status=404)
        response = HttpResponse(base64.b64decode(photo.split(',')[1]), content_type=photo.split(';')[0].removeprefix('data:'))
        response['Cache-Control'] = 'no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
