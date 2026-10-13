# Agent mark sources

Brand marks identify the corresponding third-party agents. They belong to their
respective owners; bundling them does not imply affiliation or endorsement.

- **Letta**: https://docs.letta.com/favicon.svg. The two paths are stored in
  `../agent-icons.ts`, uniformly scaled to a 22×22 mark centered in the 24×24 icon box
  (removing the favicon padding) and drawn with `currentColor` to follow the app
  theme. Letta's brand assets are excluded from
  its code license: https://github.com/letta-ai/letta-code/blob/main/LICENSE.
- **Muse Code**: `meta.svg` is the unmodified Meta company favicon from
  https://static.xx.fbcdn.net/rsrc.php/yf/r/-7pQO6hUGK_.svg, referenced by
  https://www.meta.com/brand/resources/meta/company-brand/. It identifies Meta,
  not a separate Muse trademark. It is bundled as an image so its gradient IDs
  remain isolated when several avatars appear on one page. Brand guidance:
  https://www.meta.com/brand/resources/meta/company-brand/.
- **Maki**: `maki.png` is the 96px favicon from https://github.com/tontinton/maki
  (MIT). Its 84px-wide artwork is displayed at 8/7 scale to compensate for
  transparent padding without changing the image or its aspect ratio.

Kimi is translated to center its complete mark in the 24×24 box. OpenCode is
uniformly enlarged by 10% to a 22px height, matching the optical size of the
other inset marks. Other sources are documented in `../agent-icons.ts`.

Letta and Meta sources were retrieved on 2026-10-13. These brand assets are not
covered by Pairfob's Apache-2.0 license.
