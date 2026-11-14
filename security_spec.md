# Firestore Security Specification

## 1. Data Invariants
1. Every document in `/users/{userId}` must have `uid == userId` and `uid == request.auth.uid` on creation.
2. Regular users cannot self-assign `role: "admin"`, `plan: "admin_unlimited"`, or `dailyLimit: -1`. Only the verified bootstrapped admin email (`predimahrobi@gmail.com` with `email_verified == true`) or an existing admin in `/admins/{uid}` holds admin privileges.
3. PII (`email`) in `/users/{userId}` is strictly isolated: `get` is permitted only to the owner or an admin; `list` is restricted solely to admins.
4. `uid`, `email`, and `createdAt` are immutable after creation; `createdAt`, `updatedAt`, and `lastLoginAt` must equal `request.time`.
5. Non-admin users can only modify `displayName`, `photoURL`, `lastLoginAt`, `apiKey`, and `updatedAt` via explicit action branches.

## 2. Dirty Dozen Adversarial Payloads
1. Unauthenticated read/write to `/users/u1` -> `PERMISSION_DENIED`
2. Non-owner `get` on `/users/otherUser` -> `PERMISSION_DENIED`
3. Non-admin `list` on `/users` -> `PERMISSION_DENIED`
4. Privilege escalation on create: `{ uid: "u1", role: "admin", plan: "admin_unlimited", dailyLimit: -1 }` by non-admin -> `PERMISSION_DENIED`
5. Privilege escalation on update: `{ role: "admin" }` by existing regular user -> `PERMISSION_DENIED`
6. Quota tampering on update: `{ dailyLimit: 999999, requestsToday: 0 }` by regular user -> `PERMISSION_DENIED`
7. Shadow field injection: `{ isVerified: true }` -> `PERMISSION_DENIED`
8. Spoofed email without `email_verified == true` -> `PERMISSION_DENIED`
9. Client-forged timestamp (`createdAt != request.time`) -> `PERMISSION_DENIED`
10. Invalid `apiKey` format (`"hacked_key"` missing `kmk_` prefix) -> `PERMISSION_DENIED`
11. Resource poisoning ID (`userId` > 128 chars or containing invalid characters) -> `PERMISSION_DENIED`
12. Regular user attempting to write `/admins/u1` -> `PERMISSION_DENIED`
