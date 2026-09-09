"""Owned, reusable seat geometry for the event wizard (not published inventory)."""
import base64
import copy
import io
import json
import math
import re
import uuid
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from PIL import Image
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from .models import SeatingLayoutTemplate, Venue, VenuePlan


class PlanSaveThrottle(UserRateThrottle):
    rate = '120/hour'
    scope = 'seat_plan_save'


def fail(message):
    raise serializers.ValidationError({'layout': [message]})


def number(value, lower, upper, integer=False):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and lower <= value <= upper
            and (not integer or int(value) == value))


def text(value, limit, blank=False):
    return isinstance(value, str) and len(value) <= limit and (blank or bool(value.strip()))


def validate_layout(data):
    if not isinstance(data, dict) or len(json.dumps(data)) > 2_400_000:
        fail('Plan məlumatı həddindən artıq böyükdür və ya düzgün deyil.')
    if data.get('version') != 1 or not text(data.get('name'), 160) or not text(data.get('venueKey'), 750):
        fail('Planın adı və məkanı tələb olunur.')
    try:
        uuid.UUID(data.get('id', ''))
    except (ValueError, TypeError, AttributeError):
        fail('Plan identifikatoru düzgün deyil.')
    if not text(data.get('sourceId'), 100, True) or not text(data.get('sourceName'), 160, True) or not number(data.get('page'), 1, 100, True) or not number(data.get('pageCount'), data['page'], 100, True):
        fail('Fayl səhifəsi düzgün deyil.')
    background = data.get('background')
    if not isinstance(background, str) or len(background) > 1_200_000:
        fail('Planın fonu çox böyükdür.')
    if background:
        if background.startswith('https://'):
            if not VenuePlan.objects.filter(status=VenuePlan.Status.PUBLISHED, background_image_url=background).exists():
                fail('Plan fonunun ünvanı düzgün deyil.')
        else:
            match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)', background)
            if not match:
                fail('Planın fonu PNG və ya JPG olmalıdır.')
            try:
                image = Image.open(io.BytesIO(base64.b64decode(match[2], validate=True)))
                if image.width * image.height > 4_000_000 or image.format not in ('PNG', 'JPEG'):
                    fail('Plan fonunun ölçüsü çox böyükdür.')
                image.verify()
            except serializers.ValidationError:
                raise
            except Exception:
                fail('Plan fonu açıla bilmir.')
    categories = data.get('categories')
    blocks = data.get('blocks')
    if not isinstance(categories, list) or not 1 <= len(categories) <= 20 or not isinstance(blocks, list) or not 1 <= len(blocks) <= 50:
        fail('Planın bölmə və qiymət kateqoriyalarını tamamla.')
    category_ids = set()
    for category in categories:
        if not isinstance(category, dict) or not text(category.get('id'), 100) or not text(category.get('name'), 80) or not isinstance(category.get('free'), bool) or not isinstance(category.get('price'), str):
            fail('Qiymət kateqoriyası düzgün deyil.')
        if category['id'] in category_ids:
            fail('Kateqoriya identifikatorları təkrarlanır.')
        category_ids.add(category['id'])
        if not category['free'] and (not re.fullmatch(r'\d{1,7}(\.\d{1,2})?', category['price']) or Decimal(category['price']) <= 0):
            fail('Bütün satış yerlərinə qiymət təyin et.')
    ids, labels, block_ids = set(), set(), set()
    total = blocked = 0
    for block in blocks:
        if not isinstance(block, dict) or not text(block.get('id'), 100) or not text(block.get('name'), 120) or block['id'] in block_ids:
            fail('Bölmə məlumatı düzgün deyil.')
        block_ids.add(block['id'])
        if not all(number(block.get(k), 1, 100, True) for k in ('rows', 'columns')) or not text(block.get('firstRow'), 3) or not re.fullmatch('[A-Z]{1,3}', block['firstRow']) or not number(block.get('firstSeat'), 1, 9999, True) or not number(block.get('aisle'), 0, block['columns']-1, True) or block.get('direction') not in ('ltr', 'rtl'):
            fail('Sıra və yer məlumatı düzgün deyil.')
        if not number(block.get('x'), -500, 1000) or not number(block.get('y'), -400, 650) or not number(block.get('scale'), .1, 3) or not number(block.get('rotation'), -180, 180):
            fail('Düzülüşün mövqeyi düzgün deyil.')
        seats = block.get('seats')
        if not isinstance(seats, list) or not 1 <= len(seats) <= block['rows'] * block['columns']:
            fail('Sıralar və oturacaq sayı uyğun deyil.')
        for seat in seats:
            if not isinstance(seat, dict) or not text(seat.get('id'), 160) or not text(seat.get('row'), 30) or not number(seat.get('number'), 1, 9999, True) or not isinstance(seat.get('blocked'), bool) or not text(seat.get('reason'), 160, True) or not all(number(seat.get(k), 0, 10000) for k in ('x', 'y')):
                fail('Yer məlumatı düzgün deyil.')
            label = (block['name'].strip().lower(), seat['row'], seat['number'])
            if seat['id'] in ids or label in labels:
                fail('Yer nömrələri bölmə və sıra daxilində unikal olmalıdır.')
            ids.add(seat['id']); labels.add(label)
            if seat.get('categoryId') is not None and not text(seat.get('categoryId'), 100):
                fail('Yer kateqoriyası düzgün deyil.')
            if not seat['blocked'] and seat.get('categoryId') not in category_ids:
                fail('Bütün satış yerlərinə kateqoriya təyin et.')
            total += 1
            blocked += int(seat['blocked'])
    if total > 5000 or total == blocked:
        fail('Plan 1–5000 yer arasında olmalı və satışa açıq yer saxlamalıdır.')
    key = data['venueKey']
    if key.startswith('catalog:'):
        try:
            venue = Venue.objects.get(pk=uuid.UUID(key[8:]), is_active=True)
        except (ValueError, Venue.DoesNotExist):
            fail('Məkan tapılmadı.')
        default = venue.plans.filter(status=VenuePlan.Status.PUBLISHED).order_by('-is_default', '-version').first()
        if default:
            capacity = sum(s.capacity for s in default.sections.filter(is_active=True))
            if capacity and total > capacity:
                fail(f'Plan məkanın {capacity} yerlik tutumunu keçir.')
    elif not key.startswith('manual:'):
        fail('Məkan identifikatoru düzgün deyil.')
    return total, blocked


def snapshot(template, detail=False):
    result = {'id': str(template.id), 'name': template.name, 'seat_count': template.seat_count, 'blocked_count': template.blocked_count}
    if detail:
        result['layout'] = template.layout
    return result


def published_layout(plan):
    blocks, categories = [], []
    for section in plan.sections.filter(is_active=True, seating_type='reserved_seating').prefetch_related('seats'):
        seats = list(section.seats.all())
        if not seats or any(not s.seat_number.isdigit() for s in seats):
            continue
        rows = list(dict.fromkeys(s.row_label for s in seats))
        columns = max(sum(s.row_label == row for s in seats) for row in rows)
        if len(rows) > 100 or columns > 100:
            continue
        sid = str(section.id)
        categories.append({'id': sid, 'name': section.name, 'price': '', 'free': False})
        blocks.append({'id': sid, 'name': section.name, 'rows': len(rows), 'columns': columns, 'firstRow': rows[0] if re.fullmatch('[A-Z]{1,3}', rows[0]) else 'A', 'firstSeat': min(int(s.seat_number) for s in seats), 'aisle': 0, 'direction': 'ltr', 'x': 0, 'y': 0, 'scale': 1, 'rotation': 0,
                       'seats': [{'id': str(s.id), 'row': s.row_label, 'number': int(s.seat_number), 'x': float(s.x) * 1000 / plan.canvas_width, 'y': float(s.y) * 650 / plan.canvas_height, 'blocked': not s.is_active, 'reason': '', 'categoryId': sid} for s in seats]})
    return {'version': 1, 'id': str(plan.id), 'venueKey': f'catalog:{plan.venue_id}', 'name': plan.name, 'sourceId': '', 'sourceName': plan.name, 'page': 1, 'pageCount': 1, 'background': plan.background_image_url if plan.background_image_url.startswith('https://') else '', 'blocks': blocks, 'categories': categories}


class SeatPlanListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        venue_key = request.query_params.get('venue_key', '')
        result = [snapshot(t) for t in SeatingLayoutTemplate.objects.filter(owner=request.user, venue_key=venue_key).defer('layout')[:100]]
        if venue_key.startswith('catalog:'):
            try:
                venue_id = uuid.UUID(venue_key[8:])
            except ValueError:
                return Response(result)
            for plan in VenuePlan.objects.filter(venue_id=venue_id, venue__is_active=True, status=VenuePlan.Status.PUBLISHED).prefetch_related('sections__seats')[:20]:
                layout = published_layout(plan)
                seats = [s for b in layout['blocks'] for s in b['seats']]
                if seats and len(seats) <= 5000:
                    result.append({'id': str(plan.id), 'name': plan.name, 'seat_count': len(seats), 'blocked_count': sum(s['blocked'] for s in seats)})
        return Response(result)


class SeatPlanDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [PlanSaveThrottle]

    def get(self, request, pk):
        template = SeatingLayoutTemplate.objects.filter(pk=pk, owner=request.user).first()
        if template:
            return Response(snapshot(template, detail=True))
        plan = get_object_or_404(VenuePlan, pk=pk, venue__is_active=True, status=VenuePlan.Status.PUBLISHED)
        return Response({'id': str(plan.id), 'name': plan.name, 'layout': published_layout(plan)})

    def put(self, request, pk):
        layout = request.data.get('layout') if isinstance(request.data, dict) else None
        total, blocked = validate_layout(layout)
        if str(pk) != layout['id']:
            fail('Plan identifikatorları uyğun deyil.')
        if SeatingLayoutTemplate.objects.filter(pk=pk).exclude(owner=request.user).exists():
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not SeatingLayoutTemplate.objects.filter(pk=pk, owner=request.user).exists() and SeatingLayoutTemplate.objects.filter(owner=request.user).count() >= 100:
            fail('Maksimum 100 saxlanmış plan yarada bilərsən.')
        reusable = copy.deepcopy(layout)
        for category in reusable['categories']:
            category['price'] = ''
            category['free'] = False
        try:
            with transaction.atomic():
                template, _ = SeatingLayoutTemplate.objects.update_or_create(pk=pk, owner=request.user, defaults={'venue_key': layout['venueKey'], 'name': layout['name'], 'layout': reusable, 'seat_count': total, 'blocked_count': blocked})
        except IntegrityError:
            return Response(status=status.HTTP_409_CONFLICT)
        return Response(snapshot(template, detail=True))
