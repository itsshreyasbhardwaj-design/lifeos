# Integrations

| Integration | Status | Notes |
|---|---|---|
| ICS import/export | **Implemented** | Works with Google/Outlook/Apple calendars by file; external calendars are never modified |
| Browser extension | **Implemented** | Scoped bearer token |
| PWA share target | **Implemented** | Chromium/Android only |
| Web Push | **Implemented**, device delivery unverified | Browser vendors' push services |
| Razorpay (billing) | **Partial** | Signed-webhook handler implemented and tested with locally signed fixtures; checkout/subscription creation not implemented; never tested against Razorpay |
| Google Calendar / Outlook sync | Not implemented | Needs OAuth app registration and verification |
| Gmail / email forwarding | Not implemented | Manual capture and sharing instead; no broad inbox access |
| WhatsApp / Instagram / messaging apps | Not implemented | Only user-initiated sharing; no claim of automatic access |
| DigiLocker | Not implemented | Uploads are never presented as verified |
| S3 / Cloudflare R2 storage | Not implemented | `BlobStore` interface ready |
| External AI providers | Not implemented | Consent switch exists, off |
| Email (SMTP) notifications | Not implemented | |

The Settings page lists the not-yet-available services as "Not available in this version" rather than showing fake connect buttons. LifeOS never asks for passwords to other services.
