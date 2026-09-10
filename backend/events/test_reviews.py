import copy
import uuid
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import override_settings
from rest_framework.test import APITestCase
from .models import Category, EventSubmission, SubmissionReviewLog
from .test_submissions import draft


@override_settings(ALLOWED_HOSTS=['localhost', 'testserver'])
class TeamReviewTests(APITestCase):
    def setUp(self):
        self.client.defaults['HTTP_HOST'] = 'localhost'
        users = get_user_model().objects
        self.owner = users.create_user(email='creator@example.com', display_name='Creator', phone_number='+994501234567', is_email_verified=True, account_type='organizer')
        self.reviewer = users.create_user(email='team@example.com', display_name='Reviewer', account_type='admin')
        self.reviewer.user_permissions.add(*Permission.objects.filter(content_type__app_label='events', codename__in=['view_eventsubmission', 'change_eventsubmission']))
        self.viewer = users.create_user(email='viewer@example.com', account_type='admin')
        self.viewer.user_permissions.add(Permission.objects.get(content_type__app_label='events', codename='view_eventsubmission'))
        Category.objects.create(name='Musiqi', slug='musiqi')
        self.pk = uuid.uuid4()
        self.owner_url = f'/api/event-submissions/{self.pk}/'
        self.url = f'/api/team/event-reviews/{self.pk}/'
        self.data = draft()
        self.client.force_authenticate(self.owner)
        response = self.client.put(self.owner_url, {'snapshot': self.data}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.client.force_authenticate(self.reviewer)

    def act(self, action='comment', body='Checked venue', **extra):
        payload = {'request_id': str(uuid.uuid4()), 'version': self.client.get(self.url).data['version'], 'action': action, 'body': body, 'reviewed': True, **extra}
        return self.client.post(self.url, payload, format='json')

    def test_creator_and_public_cannot_access_team_contacts_or_actions(self):
        unauthorized_admin = get_user_model().objects.create_user(email='unprivileged@example.com', account_type='admin')
        for user, code in [(None, 401), (self.owner, 403), (unauthorized_admin, 403)]:
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get('/api/team/event-reviews/').status_code, code)
            self.assertEqual(self.client.get(self.url).status_code, code)
            self.assertEqual(self.client.post(self.url, {}, format='json').status_code, code)
        self.assertEqual(SubmissionReviewLog.objects.count(), 0)

    def test_viewer_can_read_full_snapshot_creator_and_history_but_cannot_comment(self):
        self.act(body='Internal only')
        self.client.force_authenticate(self.viewer)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['creator'], {'id': self.owner.pk, 'name': 'Creator', 'email': self.owner.email, 'phone': self.owner.phone_number})
        self.assertEqual(response.data['snapshot']['media'], self.data['media'])
        self.assertEqual(response.data['snapshot']['sales'], self.data['sales'])
        self.assertEqual(response.data['history'][0]['body'], 'Internal only')
        self.assertFalse(response.data['can_moderate'])
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(self.client.post(self.url, {}, format='json').status_code, 403)

    def test_internal_comments_are_audited_private_and_idempotent(self):
        version = self.client.get(self.url).data['version']
        request_id = str(uuid.uuid4())
        response = self.act(body='Do not expose this', request_id=request_id, version=version)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['history'][0]['author'], 'Reviewer')
        payload = {'request_id': request_id, 'version': version, 'action': 'comment', 'body': 'Do not expose this'}
        self.assertEqual(self.client.post(self.url, payload, format='json').status_code, 200)
        self.assertEqual(SubmissionReviewLog.objects.count(), 1)
        payload['body'] = 'Changed'; self.assertEqual(self.client.post(self.url, payload, format='json').status_code, 409)
        self.client.force_authenticate(self.owner)
        owner_data = self.client.get(self.owner_url).data
        self.assertNotIn('history', owner_data); self.assertNotIn('creator', owner_data)
        self.assertEqual(owner_data['note'], '')

    def test_request_changes_owner_resubmits_and_team_publishes_with_history(self):
        response = self.act('changes_requested', 'Ünvanı dəqiqləşdir')
        self.assertEqual(response.status_code, 200, response.data)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(self.owner_url).data['note'], 'Ünvanı dəqiqləşdir')
        self.data['title'] = 'Updated event'
        self.assertEqual(self.client.put(self.owner_url, {'snapshot': self.data}, format='json').status_code, 200)
        self.client.force_authenticate(self.reviewer)
        self.assertEqual(len(self.client.get(self.url).data['history']), 1)
        response = self.act('approved', '')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'published')
        self.assertEqual(len(response.data['history']), 2)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(self.owner_url).data['status'], 'published')
        self.assertEqual(self.client.get(self.owner_url).data['note'], '')

    def test_stale_version_cannot_approve_after_another_review(self):
        version = self.client.get(self.url).data['version']
        self.assertEqual(self.act(body='A new check').status_code, 200)
        response = self.act('approved', '', version=version)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(EventSubmission.objects.get().event.status, 'draft')
        self.assertEqual(SubmissionReviewLog.objects.count(), 1)

    def test_invalid_decisions_do_not_publish_and_approval_revalidates_event(self):
        self.assertEqual(self.act('approved', '', reviewed=False).status_code, 400)
        self.assertEqual(self.act('changes_requested', '  ').status_code, 400)
        self.assertEqual(self.act('comment', 'x' * 2001).status_code, 400)
        item = EventSubmission.objects.get(); snapshot = copy.deepcopy(item.snapshot)
        snapshot['schedule']['startDate'] = '2020-01-01'; item.snapshot = snapshot; item.save()
        self.assertEqual(self.act('approved', '').status_code, 400)
        self.assertEqual(SubmissionReviewLog.objects.count(), 0)
        self.assertEqual(EventSubmission.objects.get().event.status, 'draft')

    def test_queue_filters_search_and_excludes_large_snapshot(self):
        data = self.client.get('/api/team/event-reviews/', {'search': self.owner.email}).data
        self.assertEqual(data['count'], 1)
        self.assertNotIn('snapshot', data['results'][0]); self.assertNotIn('history', data['results'][0])
        self.act('approved', '')
        self.assertEqual(self.client.get('/api/team/event-reviews/').data['count'], 0)
        self.assertEqual(self.client.get('/api/team/event-reviews/', {'status': 'published'}).data['count'], 1)
        self.assertEqual(self.client.get('/api/team/event-reviews/', {'status': 'invalid'}).status_code, 400)

    def test_profile_capabilities_cannot_be_self_assigned(self):
        from apps.users.serializers import UserProfileSerializer
        self.assertTrue(UserProfileSerializer(self.reviewer).data['can_moderate_events'])
        self.assertTrue(UserProfileSerializer(self.viewer).data['can_review_events'])
        self.assertFalse(UserProfileSerializer(self.viewer).data['can_moderate_events'])
        serializer = UserProfileSerializer(self.owner, data={'can_review_events': True, 'can_moderate_events': True}, partial=True)
        self.assertTrue(serializer.is_valid()); serializer.save()
        self.assertFalse(UserProfileSerializer(self.owner).data['can_review_events'])


from concurrent.futures import ThreadPoolExecutor
from django.db import close_old_connections, connections
from rest_framework.test import APIClient, APITransactionTestCase


@override_settings(ALLOWED_HOSTS=['localhost', 'testserver'])
class ConcurrentReviewTests(APITransactionTestCase):
    setUp = TeamReviewTests.setUp

    def test_concurrent_decisions_commit_only_once(self):
        version = self.client.get(self.url).data['version']
        reviewer_id = self.reviewer.pk
        url = self.url

        def decide(action):
            close_old_connections()
            try:
                client = APIClient(); client.defaults['HTTP_HOST'] = 'localhost'
                client.force_authenticate(get_user_model().objects.get(pk=reviewer_id))
                return client.post(url, {'request_id': str(uuid.uuid4()), 'version': version,
                    'action': action, 'body': 'Review complete', 'reviewed': True}, format='json').status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(decide, ['approved', 'changes_requested']))
        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(SubmissionReviewLog.objects.count(), 1)
