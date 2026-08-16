from django.test import SimpleTestCase
from rest_framework import status
from rest_framework.test import APITestCase


class HealthEndpointTests(APITestCase):
    def test_health_endpoint(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json(),
            {"status": "ok", "service": "hara-api"},
        )


class CorsConfigurationTests(SimpleTestCase):
    def test_production_frontend_domains_are_allowed(self):
        for origin in (
            "https://hara.today",
            "https://www.hara.today",
        ):
            with self.subTest(origin=origin):
                response = self.client.options(
                    "/api/events/",
                    HTTP_ORIGIN=origin,
                    HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
                )
                self.assertEqual(response["access-control-allow-origin"], origin)

    def test_order_preflight_allows_idempotency_key(self):
        response = self.client.options(
            "/api/orders/",
            HTTP_ORIGIN="https://www.hara.today",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS=(
                "authorization,content-type,idempotency-key"
            ),
        )

        allowed_headers = {
            header.strip()
            for header in response["access-control-allow-headers"].split(",")
        }

        self.assertEqual(response.status_code, 200)
        self.assertIn("idempotency-key", allowed_headers)
