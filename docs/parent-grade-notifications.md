# Parent grade notifications

Grade publication keeps the student's in-app notice and also emails each currently authorized parent of that exact child. Email contains only a generic notice and the configured application origin, never a score, feedback, child name, or classroom details.

## Delivery path

1. Manual grading, regrading, and automatic grading call `recordGradePostedNotifications` inside the grading transaction. It records student and active-parent `notification.requested` outbox events; adult mode records only the student.
2. The existing dispatcher calls `NotificationsService.materializeCommittedEvent`. Current access is checked before creating the in-app notification. Announcement notices and eligible parent grade notices atomically enqueue `notification.email.requested` through the existing `OutboxWriter`.
3. The existing announcement-module `NotificationEmailHandler` invokes `NotificationEmailService.deliver`. `prepareNotificationEmail` rechecks live school/classroom access, active student enrollment, the exact active parent link, and adult mode before sending.
4. A successful send completes the unique `(notification, email)` receipt. Replaying a completed delivery skips sending. Uncertain outcomes reuse the stable `notification:<id>:email` provider key; external deduplication depends on the email port/provider honoring that key.

## Boundaries

- The email link uses the origin of the existing `invitationAcceptUrlBase` configuration; no new configuration or frontend route is introduced.
- A remaining sibling link or staff role does not substitute for the exact parent link. Revoked access skips queued mail without deleting notification history.
- Student grade notices remain in-app only. Announcement email content and eligibility are unchanged.
- Provider failures use the existing dispatcher's bounded attempts and exponential backoff (5 seconds initially, capped at 1 hour). Errors retain only a generic delivery failure, not provider content or addresses.
- Authorization is checked immediately before delivery; this does not cancel mail already accepted by a provider when a concurrent revocation occurs.

## Verification

The notification PostgreSQL integration suite exercises committed recording, dispatch, fake-provider delivery, revocation, adult mode, deleted contexts, exact-child/classroom scope, replay, uncertain provider outcomes, retry backoff and exhaustion. The grades integration suite verifies real committed grading through the same path. Tests use the in-memory email adapter, never external mail.

See [communication and notifications](../rules/communication-and-notifications.md) and [parent permissions](../rules/classrooms-and-roles.md#parents-and-adult-mode) for requirements.
