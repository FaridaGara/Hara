"""Validate the proxy trust boundary before serving login requests."""

from ipaddress import ip_network
import os

from django.conf import settings
from django.core.checks import Error, Warning, register


@register()
def login_proxy_checks(app_configs, **kwargs):
    networks = settings.LOGIN_TRUSTED_PROXY_CIDRS
    errors = []
    for value in networks:
        try:
            network = ip_network(value)
        except (TypeError, ValueError):
            errors.append(Error(
                "LOGIN_TRUSTED_PROXY_CIDRS contains an invalid network.",
                hint="Use verified, canonical IPv4 or IPv6 CIDRs.",
                id="users.E001",
            ))
            continue
        if network.prefixlen == 0:
            errors.append(Error(
                "LOGIN_TRUSTED_PROXY_CIDRS must not trust every address.",
                hint="Configure only verified infrastructure peer networks.",
                id="users.E002",
            ))
    if not networks and os.getenv("RAILWAY_PUBLIC_DOMAIN"):
        errors.append(Warning(
            "Railway login limits currently use the direct proxy peer address.",
            hint="Verify the ingress peer CIDRs and forwarded-header behavior before "
                 "setting LOGIN_TRUSTED_PROXY_CIDRS; visitors may share one IP budget.",
            id="users.W001",
        ))
    return errors
