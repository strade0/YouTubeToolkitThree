# Privacy Policy — YouTube Toolkit

Last updated: 24 August 2026

YouTube Toolkit is a Chrome extension that runs only on youtube.com. It is not affiliated with YouTube, Google, or Alphabet.

This policy describes what the extension can do, what it stores on your device, and what it does **not** collect.

## What the extension does

All features run locally in the YouTube tab. Each can be turned off from the popup; a master switch turns every feature off at once.

- **Volume Drag** — Drag horizontally across the video to change volume. A local on-screen HUD (waveform or minimal pill) shows the current level. You can choose the drag trigger, sensitivity, HUD style, and whether the pill follows the mouse or stays at the click position. Volume is applied to the YouTube player in that tab and remembered so it stays consistent there.
- **Layout Trimmer** — Narrows YouTube’s page width, resizes the suggested-videos sidebar, and aligns the page (left / center / right). Optional: apply on Home/Search/Subscriptions, constrain theater mode, and show a floating width bar. Keyboard shortcuts (`Alt + [`, `Alt + ]`, `Alt + \`) only change layout in the current tab.
- **SkipIt** — After a single skip keypress (Right Arrow or L), clicks YouTube’s native **Jump ahead** control. Jump count and estimated time saved stay on your device.
- **2x Speed Lock** — Hold left-click (YouTube’s built-in 2x), hover YouTube’s native 2x control, and release to lock or reset playback speed. The chosen lock speed is a local setting. Speed is not sent anywhere.

The extension does not change video recommendations, ads, comments, or account settings.

## Permissions

Chrome requires these permissions for the features above:

| Permission | Why it is used |
| --- | --- |
| `storage` | Save your feature toggles and settings (`chrome.storage.sync`) and SkipIt stats (`chrome.storage.local`). Nothing in storage is uploaded to the developer. |
| Host access to `*.youtube.com` | Inject content scripts only on YouTube so the features can read the player/page DOM and apply volume, layout, skip, and speed changes in that tab. |

The extension does not request access to other sites, your Google account, cookies for other origins, camera, microphone, location, or browsing history.

## Data we collect

The extension does **not** send any data to the developer or to any server operated by the developer. There is no analytics, crash reporting, advertising, telemetry, or account system.

Settings and stats stay in your browser:

- **Feature settings** (master on/off; volume sensitivity, drag trigger, HUD style, follow-cursor; layout width, sidebar width, alignment and related toggles; 2x lock speed; and similar) are saved with Chrome’s `storage.sync` so they persist and can sync with your Chrome profile if you have Chrome sync enabled.
- **Volume** is also written to YouTube’s own page storage (`localStorage` / `sessionStorage` on youtube.com) so the player volume stays consistent in that tab. That data never leaves youtube.com except as YouTube itself already handles player volume.
- **SkipIt stats** (jump count, estimated time saved) are stored only in `chrome.storage.local` on your device.

The extension reads the YouTube page only to:

- detect drag/click gestures on the video player and update volume and the local HUD
- resize and align layout containers
- find and click YouTube’s native “Jump ahead” control after a single skip
- detect hold-click and release over YouTube’s native 2x control, then lock or reset playback speed (it does not send speed data anywhere)

It does not read your Google account, watch history, comments, chat, search queries, or video metadata for any other purpose, and it does not transmit page contents off the device.

## Network

The extension does not make its own network requests. Any traffic you see is YouTube’s normal site traffic. There is no remote configuration, no phone-home, and no third-party scripts loaded by this extension.

## Sharing

Nothing is sold, rented, or shared with third parties. The developer cannot see your settings, volume, layout, skip stats, or watch activity.

## Children’s privacy

The extension is a YouTube page tool. It does not knowingly collect personal information from anyone, including children.

## Changes

If this policy changes, the “Last updated” date above will be revised. Material changes will be reflected in the Chrome Web Store listing.

## Contact

If you have questions about this policy, use the contact email on the Chrome Web Store listing.
