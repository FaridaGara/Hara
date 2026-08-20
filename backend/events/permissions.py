from rest_framework.permissions import BasePermission


class IsOrganizer(BasePermission):
    message = "Bu əməliyyat yalnız təşkilatçı hesabları üçündür."

    def has_permission(self, request, view):
        user = request.user

        return bool(
            user
            and user.is_authenticated
            and (
                user.is_superuser
                or user.account_type == "organizer"
            )
        )


class HasAdminModelPermission(BasePermission):
    message = "Bu əməliyyat üçün admin icazəniz yoxdur."

    action_map = {
        "GET": "view",
        "HEAD": "view",
        "OPTIONS": "view",
        "POST": "add",
        "PUT": "change",
        "PATCH": "change",
        "DELETE": "delete",
    }

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser:
            return True

        if user.account_type != "admin":
            return False

        resource = getattr(view, "permission_resource", None)
        action = self.action_map.get(request.method)
        if not resource or not action:
            return False

        return user.has_perm(f"events.{action}_{resource}")
