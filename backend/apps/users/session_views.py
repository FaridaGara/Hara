from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .sessions import revoke_session, rotate_session


class SessionRefreshInput(serializers.Serializer):
    refresh = serializers.CharField(write_only=True, max_length=4096, trim_whitespace=False)


class SessionTokenAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get_authenticate_header(self, request):
        return 'Bearer realm="api"'


class SessionRefreshAPIView(SessionTokenAPIView):
    @extend_schema(
        auth=[], request=SessionRefreshInput,
        responses={200: inline_serializer(name="RotatedSession", fields={
            "access": serializers.CharField(), "refresh": serializers.CharField(),
        }), 401: None},
    )
    def post(self, request):
        serializer = SessionRefreshInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(rotate_session(serializer.validated_data["refresh"]))


class SessionLogoutAPIView(SessionTokenAPIView):

    @extend_schema(auth=[], request=SessionRefreshInput, responses={204: None, 401: None})
    def post(self, request):
        serializer = SessionRefreshInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        revoke_session(serializer.validated_data["refresh"])
        return Response(status=status.HTTP_204_NO_CONTENT)
