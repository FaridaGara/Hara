from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import EventSubmission, SubmissionReviewLog
from .permissions import HasEventReviewPermission, can_review_events
from .review_service import review_submission, review_version
from .submissions import output, SubmissionThrottle


def review_output(item, *, detail=False, user):
    data = output(item, detail)
    data['creator'] = {'id': item.owner_id, 'name': item.owner.display_name or item.owner.get_full_name() or item.owner.email,
                       'email': item.owner.email, 'phone': item.owner.phone_number}
    data['version'] = review_version(item)
    data['can_moderate'] = can_review_events(user, change=True)
    if detail:
        data['history'] = [{'id': str(log.pk), 'action': log.action, 'body': log.body,
                            'author': log.author.display_name or log.author.get_full_name() or log.author.email,
                            'created_at': log.created_at} for log in item.review_logs.select_related('author')]
    return data


class ReviewPagination(PageNumberPagination):
    page_size = 20


class ReviewListAPIView(APIView):
    permission_classes = [IsAuthenticated, HasEventReviewPermission]

    def get(self, request):
        status = request.query_params.get('status', 'pending')
        if status not in ('all', 'pending', 'changes_requested', 'published', 'cancelled', 'completed'):
            raise serializers.ValidationError({'detail': 'Status düzgün deyil.'})
        search = request.query_params.get('search', '').strip()
        if len(search) > 128:
            raise serializers.ValidationError({'detail': 'Axtarış 128 simvoldan uzun ola bilməz.'})
        items = EventSubmission.objects.select_related('owner', 'event').order_by('-updated_at', '-id')
        if status in ('pending', 'changes_requested'):
            items = items.filter(status=status, event__status='draft')
        elif status != 'all':
            items = items.filter(event__status=status)
        if search:
            items = items.filter(Q(event__title__icontains=search) | Q(owner__email__icontains=search) | Q(owner__display_name__icontains=search))
        paginator = ReviewPagination()
        page = paginator.paginate_queryset(items, request, view=self)
        response = paginator.get_paginated_response([review_output(item, user=request.user) for item in page])
        response['Cache-Control'] = 'private, no-store'
        return response


class ReviewActionSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()
    version = serializers.RegexField(r'^[0-9a-f]{64}$')
    action = serializers.ChoiceField(choices=SubmissionReviewLog.Action.values)
    body = serializers.CharField(max_length=2000, allow_blank=True, default='')
    reviewed = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs['action'] == 'approved' and not attrs['reviewed']:
            raise serializers.ValidationError({'detail': 'Tədbir məlumatlarını yoxladığını təsdiqlə.'})
        if attrs['action'] != 'approved' and not attrs['body']:
            raise serializers.ValidationError({'detail': 'Şərhi yaz.'})
        return attrs


class ReviewDetailAPIView(APIView):
    permission_classes = [IsAuthenticated, HasEventReviewPermission]
    throttle_classes = [SubmissionThrottle]

    def get(self, request, pk):
        item = get_object_or_404(EventSubmission.objects.select_related('owner', 'event'), pk=pk)
        response = Response(review_output(item, detail=True, user=request.user))
        response['Cache-Control'] = 'private, no-store'
        return response

    def post(self, request, pk):
        serializer = ReviewActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        item = review_submission(pk, request.user, action=data['action'], body=data['body'], request_id=data['request_id'], version=data['version'])
        response = Response(review_output(item, detail=True, user=request.user))
        response['Cache-Control'] = 'private, no-store'
        return response
