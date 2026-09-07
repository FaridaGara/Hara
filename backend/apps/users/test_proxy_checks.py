import os
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .checks import login_proxy_checks


class LoginProxyCheckTests(SimpleTestCase):
    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=["0.0.0.0/0", "::/0"])
    def test_global_trust_is_rejected(self):
        self.assertEqual([x.id for x in login_proxy_checks(None)], ["users.E002", "users.E002"])

    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=["not-a-network", "10.0.0.1/24"])
    def test_invalid_or_noncanonical_networks_are_rejected(self):
        self.assertEqual([x.id for x in login_proxy_checks(None)], ["users.E001", "users.E001"])

    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=["10.0.0.0/24", "2001:db8::/64"])
    def test_valid_specific_networks_pass(self):
        self.assertEqual(login_proxy_checks(None), [])

    @override_settings(LOGIN_TRUSTED_PROXY_CIDRS=[])
    def test_railway_without_proxy_configuration_warns(self):
        with patch.dict(os.environ, {"RAILWAY_PUBLIC_DOMAIN": "example.up.railway.app"}):
            self.assertEqual([x.id for x in login_proxy_checks(None)], ["users.W001"])
        with patch.dict(os.environ, {"RAILWAY_PUBLIC_DOMAIN": ""}):
            self.assertEqual(login_proxy_checks(None), [])

    @override_settings(LOGIN_CLIENT_IP_SOURCE="invalid", LOGIN_TRUSTED_PROXY_CIDRS=[])
    def test_unknown_source_is_rejected(self):
        self.assertEqual([x.id for x in login_proxy_checks(None)], ["users.E003"])

    @override_settings(LOGIN_CLIENT_IP_SOURCE="railway", LOGIN_TRUSTED_PROXY_CIDRS=[])
    def test_railway_requires_public_domain(self):
        with patch.dict(os.environ, {"RAILWAY_PUBLIC_DOMAIN": ""}):
            self.assertEqual([x.id for x in login_proxy_checks(None)], ["users.E004"])
        with patch.dict(os.environ, {"RAILWAY_PUBLIC_DOMAIN": "example.up.railway.app"}):
            self.assertEqual(login_proxy_checks(None), [])

    @override_settings(LOGIN_CLIENT_IP_SOURCE="railway", LOGIN_TRUSTED_PROXY_CIDRS=["10.0.0.0/24"])
    def test_mixed_trust_modes_are_rejected(self):
        with patch.dict(os.environ, {"RAILWAY_PUBLIC_DOMAIN": "example.up.railway.app"}):
            self.assertEqual([x.id for x in login_proxy_checks(None)], ["users.E005"])
