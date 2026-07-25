from rest_framework.permissions import BasePermission


class IsOrganizer(BasePermission):
    message = "Bu əməliyyat yalnız təşkilatçı hesabları üçündür."

    def has_permission(self, request, view):
        user = request.user

        return bool(
            user
            and user.is_authenticated
            and (
                user.is_staff
                or user.account_type == "organizer"
            )
        )