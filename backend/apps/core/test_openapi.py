import json

from django.conf import settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APISimpleTestCase


class OpenAPIContractTests(APISimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        response = APIClient().get(
            reverse("api-schema"),
            HTTP_ACCEPT="application/json",
        )
        cls.schema_response = response
        cls.schema = response.json()

    def test_schema_is_a_valid_openapi_document_without_database_access(self):
        self.assertEqual(
            self.schema_response.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(self.schema["openapi"], "3.0.3")
        self.assertIn("paths", self.schema)
        self.assertIn("components", self.schema)
        operation_ids = [
            operation["operationId"]
            for path_item in self.schema["paths"].values()
            for method, operation in path_item.items()
            if method
            in {"get", "post", "put", "patch", "delete"}
        ]
        self.assertEqual(
            len(operation_ids),
            len(set(operation_ids)),
        )

    def test_interactive_docs_open(self):
        response = self.client.get(reverse("api-docs"))

        self.assertEqual(
            response.status_code,
            status.HTTP_200_OK,
        )
        self.assertContains(response, "swagger-ui")

    def test_schema_contains_core_ticket_order_and_payment_paths(self):
        expected_paths = {
            "/api/health/",
            "/api/events/",
            "/api/orders/",
            "/api/orders/{order_id}/payments/",
            "/api/payments/sandbox/{payment_id}/complete/",
            "/api/payments/webhook/sandbox/",
            "/api/tickets/",
            "/api/tickets/{ticket_id}/",
            "/api/organizer/events/{event_slug}/check-ins/",
        }

        self.assertTrue(
            expected_paths.issubset(self.schema["paths"])
        )
        self.assertIn(
            "get",
            self.schema["paths"][
                "/api/organizer/events/{event_slug}/check-ins/"
            ],
        )
        self.assertIn(
            "post",
            self.schema["paths"][
                "/api/organizer/events/{event_slug}/check-ins/"
            ],
        )

    def test_protected_and_public_security_contracts_are_correct(self):
        security_schemes = self.schema["components"][
            "securitySchemes"
        ]
        self.assertEqual(
            security_schemes["jwtAuth"]["scheme"],
            "bearer",
        )
        self.assertIn(
            "security",
            self.schema["paths"]["/api/orders/"]["post"],
        )

        for path, method in [
            ("/api/health/", "get"),
            ("/api/events/", "get"),
            ("/api/events/{slug}/", "get"),
            ("/api/auth/login/", "post"),
            ("/api/payments/webhook/sandbox/", "post"),
        ]:
            self.assertNotIn(
                "security",
                self.schema["paths"][path][method],
            )

    def test_public_event_detail_documents_attendee_ticket_types(self):
        detail_operation = self.schema["paths"][
            "/api/events/{slug}/"
        ]["get"]
        detail_reference = detail_operation["responses"]["200"][
            "content"
        ]["application/json"]["schema"]["$ref"]
        detail_schema = self.schema["components"]["schemas"][
            detail_reference.rsplit("/", 1)[-1]
        ]
        ticket_type_reference = detail_schema["properties"][
            "ticket_types"
        ]["items"]["$ref"]
        ticket_type_schema = self.schema["components"]["schemas"][
            ticket_type_reference.rsplit("/", 1)[-1]
        ]
        properties = ticket_type_schema["properties"]

        self.assertEqual(
            set(properties),
            {
                "id",
                "name",
                "price",
                "currency",
                "available_quantity",
                "sales_start_at",
                "sales_end_at",
                "min_quantity",
                "max_quantity",
                "sales_status",
                "is_available",
            },
        )
        self.assertEqual(properties["price"]["type"], "string")
        self.assertEqual(properties["price"]["format"], "decimal")
        self.assertTrue(properties["sales_start_at"]["nullable"])
        self.assertTrue(properties["sales_end_at"]["nullable"])

        currency_reference = properties["currency"]["allOf"][0][
            "$ref"
        ]
        currency_values = self.schema["components"]["schemas"][
            currency_reference.rsplit("/", 1)[-1]
        ]["enum"]
        self.assertEqual(currency_values, ["AZN"])

        sales_status_reference = properties["sales_status"][
            "allOf"
        ][0]["$ref"]
        sales_status_values = self.schema["components"]["schemas"][
            sales_status_reference.rsplit("/", 1)[-1]
        ]["enum"]
        self.assertEqual(
            set(sales_status_values),
            {"UPCOMING", "AVAILABLE", "SOLD_OUT", "ENDED"},
        )
        self.assertIn("404", detail_operation["responses"])
        self.assertNotIn("security", detail_operation)

    def test_ticket_wallet_documents_lifecycle_currency_and_qr_payload(self):
        ticket_schema = self.schema["components"]["schemas"][
            "TicketRead"
        ]
        properties = ticket_schema["properties"]

        self.assertEqual(properties["qr_code"]["format"], "uuid")
        self.assertIn("currency", properties)
        self.assertTrue(properties["checked_in_at"]["nullable"])
        status_reference = properties["status"]["allOf"][0]["$ref"]
        status_values = self.schema["components"]["schemas"][
            status_reference.rsplit("/", 1)[-1]
        ]["enum"]
        self.assertEqual(
            set(status_values),
            {"valid", "used", "cancelled", "refunded"},
        )
        self.assertIn(
            "404",
            self.schema["paths"]["/api/tickets/{ticket_id}/"][
                "get"
            ]["responses"],
        )

    def test_uuid_and_slug_path_parameters_have_correct_types(self):
        ticket_parameters = self.schema["paths"][
            "/api/tickets/{ticket_id}/"
        ]["get"]["parameters"]
        ticket_id = next(
            parameter
            for parameter in ticket_parameters
            if parameter["name"] == "ticket_id"
        )
        self.assertEqual(ticket_id["schema"]["format"], "uuid")

        check_in_parameters = self.schema["paths"][
            "/api/organizer/events/{event_slug}/check-ins/"
        ]["post"]["parameters"]
        event_slug = next(
            parameter
            for parameter in check_in_parameters
            if parameter["name"] == "event_slug"
        )
        self.assertEqual(
            event_slug["schema"]["type"],
            "string",
        )

    def test_ticket_filters_are_documented(self):
        parameters = self.schema["paths"]["/api/tickets/"]["get"][
            "parameters"
        ]
        parameters_by_name = {
            parameter["name"]: parameter
            for parameter in parameters
        }

        self.assertEqual(
            set(parameters_by_name["event_status"]["schema"]["enum"]),
            {"upcoming", "past"},
        )
        self.assertEqual(
            set(
                parameters_by_name["is_checked_in"]["schema"]["enum"]
            ),
            {"true", "false"},
        )

    def test_capacity_idempotency_and_duplicate_scan_conflicts_are_documented(
        self,
    ):
        order_post = self.schema["paths"]["/api/orders/"]["post"]
        self.assertIn("409", order_post["responses"])
        order_conflict = self.schema["components"]["schemas"][
            "OrderConflict"
        ]
        code_reference = order_conflict["properties"]["code"]["$ref"]
        code_schema_name = code_reference.rsplit("/", 1)[-1]
        code_values = self.schema["components"]["schemas"][
            code_schema_name
        ]["enum"]
        self.assertIn("INSUFFICIENT_CAPACITY", code_values)
        self.assertIn("IDEMPOTENCY_KEY_REUSED", code_values)

        check_in_post = self.schema["paths"][
            "/api/organizer/events/{event_slug}/check-ins/"
        ]["post"]
        self.assertIn("409", check_in_post["responses"])
        self.assertEqual(
            check_in_post["responses"]["409"]["content"][
                "application/json"
            ]["schema"]["$ref"],
            "#/components/schemas/AlreadyCheckedIn",
        )

    def test_schema_contains_no_runtime_secret_or_real_pii_values(self):
        serialized_schema = json.dumps(
            self.schema,
            ensure_ascii=False,
        )
        self.assertNotIn("@hara.today", serialized_schema)
        self.assertNotIn("+994", serialized_schema)

        sensitive_values = [
            settings.PAYMENT_WEBHOOK_SECRET,
            settings.DATABASES["default"]["PASSWORD"],
            settings.SECRET_KEY,
        ]

        for value in sensitive_values:
            if value and len(value) >= 8:
                self.assertNotIn(value, serialized_schema)
