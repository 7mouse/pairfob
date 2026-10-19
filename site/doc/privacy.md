---
title: Privacy
description: What stays on your devices, what pairfob.com records, and how notifications work.
---

# Privacy

Pairfob connects your paired browser to the computer running Pairfob. The official relay is **pairfob.com**, hosted on Cloudflare.

## Your content and keys

Pairing credentials and session encryption keys stay on your computer and paired devices. Terminal content, agent conversations, files and commands travel inside encrypted envelopes. The relay routes those envelopes; it does not decrypt or inspect their contents. Your computer stores its device list and push subscriptions locally. Your browser stores pairing credentials and preferences locally.

## Service metadata and usage measurements

End-to-end encryption does not hide connection metadata. The service handles computer identifiers, connection times, frame sizes, errors and network addresses. Registration records include a daemon identifier, registration time, grant association, revocation status and an IP hash used for abuse controls. Resetting the computer's identity creates another registration; these records do not identify a unique person or physical computer.

The service also records each identity's first **observed authenticated phone connection** and most recent relay-observed connection activity, updated at most once per five minutes during normal operation. Keepalives count as connection activity; this is not a measure of what you typed or how much work you did. After a session switches to direct P2P, its activity is not visible to the relay. For older installations, the first observation is not necessarily the original pairing date.

The website and app send first-party measurements for page categories, pairing outcomes, reconnects and selected feature openings. These measurements use predefined labels, not command text, file contents or conversation text. Operational logs can also contain request metadata, including URLs; avoid sharing pairing links or logs publicly.

These records help operate the service, prevent abuse and measure registration-to-connection conversion. The aggregate conversion endpoint requires operator authentication.

## Retention

- Registration and first/latest connection records currently have no automatic expiry. They remain until removed by the service operator.
- Analytics Engine event records are retained for three months. Operational logs follow the Cloudflare retention configured for the service, separately from those analytics records.
- Local credentials and preferences remain on your devices until removed. Unpairing revokes a device's access; it does not automatically erase historical service metrics.

For a question about stored service records or a removal request, contact the project through [GitHub](https://github.com/arronKler/pairfob). Do not post pairing codes, keys, subscription endpoints or private content in a public issue.

## Notifications

The computer's ability to send notifications is on by default. Your browser still needs your permission and a subscription before it receives notifications. Choosing **Later** on the invitation does not grant permission. You can disable sending on the computer or revoke notification permission on the device; see [Notifications](/push).

Your computer sends encrypted Web Push payloads directly to the push provider selected by your browser, such as Apple or Google. That provider handles delivery and can observe delivery metadata; notification text is decrypted on your device and may appear on its lock screen according to your system settings. The relay does not hold the computer's push private key.
