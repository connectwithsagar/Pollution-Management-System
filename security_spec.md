# AetherGrid Firestore Security Specification

## 1. Data Invariants
1. **User Profile Isolation (`users/{userId}`)**: A user can only read, create, or update their own profile (`userId == request.auth.uid`). Self-assignment of `role == 'admin'` is forbidden on create and update.
2. **Custom Marker Ownership (`markers/{markerId}`)**: Custom markers belong strictly to `ownerId == request.auth.uid`. Latitude must stay within `[-90, 90]`, longitude within `[-180, 180]`, and `ownerId` and `createdAt` are immutable.
3. **Saved Locations Ownership (`savedLocations/{locationId}`)**: Saved locations belong strictly to `ownerId == request.auth.uid` with coordinate bounds enforced.
4. **Alert Rules & Alerts Ownership (`alertRules/{ruleId}`, `alerts/{alertId}`)**: Users can only list, read, create, update, or delete their own alert rules and alerts (`resource.data.ownerId == request.auth.uid`).
5. **IoT Sensor Devices (`iotSensors/{deviceId}`)**: Authenticated users may read sensor metadata; creation and updates require `ownerId == request.auth.uid` or `isAdmin()`.
6. **Temporal Integrity**: `createdAt` and `updatedAt` (and `triggeredAt`) must equal `request.time` (server timestamps).

## 2. Adversarial "Dirty Dozen" Payloads Tested
1. Cross-user marker read (`get /markers/otherUserMarker`) -> `PERMISSION_DENIED`
2. Cross-user marker update (`update /markers/otherUserMarker`) -> `PERMISSION_DENIED`
3. Privilege escalation on user create (`create /users/uid { role: 'admin' }`) -> `PERMISSION_DENIED`
4. Privilege escalation on user update (`update /users/uid { role: 'admin' }`) -> `PERMISSION_DENIED`
5. Shadow field injection (`create /markers/m1 { ..., extraField: true }`) -> `PERMISSION_DENIED`
6. Oversized string DoS (`create /markers/m1 { name: <500 chars> }`) -> `PERMISSION_DENIED`
7. Out-of-bounds coordinates (`create /markers/m1 { lat: 120, lon: 250 }`) -> `PERMISSION_DENIED`
8. Spoofed `ownerId` (`create /markers/m1 { ownerId: 'victim_uid' }`) -> `PERMISSION_DENIED`
9. Client-forged timestamp (`create /markers/m1 { createdAt: '2020-01-01' }`) -> `PERMISSION_DENIED`
10. Unverified email write (`email_verified == false`) -> `PERMISSION_DENIED`
11. Blanket collection list (`list /markers` without `where('ownerId', '==', uid)`) -> `PERMISSION_DENIED`
12. Mutating immutable `ownerId` or `createdAt` on marker update -> `PERMISSION_DENIED`
