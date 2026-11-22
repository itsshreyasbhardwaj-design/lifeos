# Notification delivery

| Channel | Status | What "delivered" means |
|---|---|---|
| In-app (bell, Today) | Implemented, verified | The notification row was written in the same transaction → `delivered` |
| Web Push (browser / installed PWA) | Implemented; encryption and VAPID verified by tests; **real delivery to a device not verified** | Push service answered 2xx → `accepted`. LifeOS never claims the person saw it. |
| Email | Not implemented | — |
| Native push (APNs/FCM SDK) | Not implemented | — |

## Web Push implementation
`packages/core/src/push.ts` implements VAPID (RFC 8292, ES256 JWT) and `aes128gcm` payload encryption (RFC 8291/8188) on `node:crypto`. Tests decrypt the payload with an independently written receiver and verify the JWT signature. Keys: `LIFEOS_VAPID_PUBLIC` + `LIFEOS_VAPID_PRIVATE_PEM`, or generated once into `data/vapid.json` in development. Endpoints are restricted to known push-service hosts (FCM, Mozilla, Apple, Windows) so a forged subscription can't make the server POST into a private network.

## Platform reality
* Chrome/Edge/Firefox desktop and Chrome on Android: push works while the browser is installed; Android battery optimisation can delay it.
* iPhone/iPad: Web Push only for PWAs **added to the Home Screen**, iOS/iPadOS 16.4+.
* Safari on macOS: supported in recent versions.
* If push is unavailable the in-app channel still records everything; Settings shows the device's push state.
