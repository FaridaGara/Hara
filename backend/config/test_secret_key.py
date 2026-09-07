import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured


class SecretKeySettingsTests(unittest.TestCase):
    def load_settings(self, environment):
        # Execute the real settings without reading local secrets or using a DB.
        with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
            return runpy.run_path(str(Path(__file__).with_name("settings.py")))

    def test_production_rejects_missing_empty_and_blank_keys(self):
        for debug in (None, "false"):
            for key in (None, "", " \t "):
                with self.subTest(debug=debug, key=key):
                    env = {} if debug is None else {"DJANGO_DEBUG": debug}
                    if key is not None:
                        env["DJANGO_SECRET_KEY"] = key
                    with self.assertRaises(ImproperlyConfigured):
                        self.load_settings(env)

    def test_production_rejects_development_keys(self):
        for key in (
            "django-insecure-local-development-only",
            "replace-with-a-local-development-secret",
            "django-insecure-generated-development-key",
        ):
            with self.subTest(key=key):
                with self.assertRaises(ImproperlyConfigured) as error:
                    self.load_settings({"DJANGO_SECRET_KEY": key})
                self.assertIn("DJANGO_SECRET_KEY", str(error.exception))
                self.assertNotIn(key, str(error.exception))

    def test_production_preserves_supplied_key(self):
        key = "test-only-production-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        settings = self.load_settings({"DJANGO_SECRET_KEY": key})
        self.assertFalse(settings["DEBUG"])
        self.assertEqual(settings["SECRET_KEY"], key)

    def test_explicit_debug_allows_local_fallback(self):
        for key in (None, "", " \t "):
            with self.subTest(key=key):
                env = {"DJANGO_DEBUG": "true"}
                if key is not None:
                    env["DJANGO_SECRET_KEY"] = key
                settings = self.load_settings(env)
                self.assertTrue(settings["DEBUG"])
                self.assertEqual(
                    settings["SECRET_KEY"], "django-insecure-local-development-only",
                )

    def test_debug_preserves_explicit_key(self):
        settings = self.load_settings({
            "DJANGO_DEBUG": "true",
            "DJANGO_SECRET_KEY": "replace-with-a-local-development-secret",
        })
        self.assertEqual(
            settings["SECRET_KEY"], "replace-with-a-local-development-secret",
        )
