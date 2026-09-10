from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Notification
from .serializers import NotificationSerializer


class PrivateNotificationView(APIView):
    permission_classes = [IsAuthenticated]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        return response


class NotificationInboxAPIView(PrivateNotificationView):
    def get(self, request):
        items = Notification.objects.filter(user=request.user).select_related('event__cancellation', 'organizer').order_by('-created_at', '-pk')
        pagination = PageNumberPagination()
        pagination.page_size = 20
        page = pagination.paginate_queryset(items, request, view=self)
        response = pagination.get_paginated_response(NotificationSerializer(page, many=True).data)
        response.data['unread_count'] = items.filter(read_at__isnull=True).count()
        return response


class NotificationCountAPIView(PrivateNotificationView):
    def get(self, request):
        return Response({'unread_count': Notification.objects.filter(user=request.user, read_at__isnull=True).count()})


class NotificationReadAPIView(PrivateNotificationView):
    def post(self, request, pk):
        item = get_object_or_404(Notification, user=request.user, pk=pk)
        Notification.objects.filter(pk=item.pk, user=request.user, read_at__isnull=True).update(read_at=timezone.now())
        item.refresh_from_db()
        return Response({'id': item.pk, 'read_at': item.read_at})
