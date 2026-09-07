"""Validate the proxy trust boundary before serving login requests."""

from ipaddress import ip_network
import os

from django.conf import settings
from django.core.checks import Error, Warning, register


@register()
def login_proxy_checks(app_configs, **kwargs):
    networks = settings.LOGIN_TRUSTED_PROXY_CIDRS
    errors = []
    source = settings.LOGIN_CLIENT_IP_SOURCE
    if source not in {"trusted-proxy", "railway"}:
        errors.append(Error(
            "LOGIN_CLIENT_IP_SOURCE must be trusted-proxy or railway.",
            id="users.E003",
        ))
    if source == "railway":
        if not os.getenv("RAILWAY_PUBLIC_DOMAIN"):
            errors.append(Error(
                "Railway client IP mode requires a Railway public HTTP domain.",
                hint="Use trusted-proxy outside Railway; the domain variable alone "
                     "does not establish a secure ingress boundary.",
                id="users.E004",
            ))
        if networks:
            errors.append(Error(
                "Railway client IP mode cannot be combined with trusted proxy CIDRs.",
                hint="Clear LOGIN_TRUSTED_PROXY_CIDRS when using Railway HTTP ingress.",
                id="users.E005",
            ))
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
    if source == "trusted-proxy" and not networks and os.getenv("RAILWAY_PUBLIC_DOMAIN"):
        errors.append(Warning(
            "Railway login limits currently use the direct proxy peer address.",
            hint="After verifying HTTP-edge-only ingress, set LOGIN_CLIENT_IP_SOURCE=railway; "
                 "see backend/docs/login-rate-limits.md. Visitors may share one IP budget.",
            id="users.W001",
        ))
    return errors
