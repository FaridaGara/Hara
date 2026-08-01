from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response


@extend_schema(
    operation_id="health",
    auth=[],
    request=None,
    description="Public service liveness response.",
    responses={
        200: inline_serializer(
            name="HealthResponse",
            fields={
                "status": serializers.CharField(),
                "service": serializers.CharField(),
            },
        )
    },
)
@api_view(["GET"])
def health(request):
    return Response({"status": "ok", "service": "hara-api"})
