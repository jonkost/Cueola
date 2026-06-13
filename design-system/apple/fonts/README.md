# San Francisco Font Staging Policy

The supplied fonts were inspected in place and were not copied into this
repository.

## Local inventory

- `/Library/Fonts/SF-Pro.ttf`: variable SF Pro family with nine weights and
  compressed, condensed, standard, and expanded widths.
- `/Library/Fonts/SF-Compact.ttf`: variable SF Compact family with nine weights.

SF Pro is appropriate for Apple platform interfaces. SF Compact is optimized for
small sizes and narrow columns and is the watchOS system font.

## Repository policy

Apple's typography guidance says to access system fonts through the system and
not embed them in an app. For Cueola's web client, use a system font stack that
starts with `-apple-system` and `BlinkMacSystemFont`. Apple devices can then use
San Francisco without the project serving or redistributing Apple font files.

The local TTF files can be used in design tools for Apple-platform mockups under
Apple's applicable font license. They must not be committed, converted to web
fonts, placed on a CDN, or referenced with `@font-face` without a separate license
review.

Official reference: [Fonts for Apple platforms](https://developer.apple.com/fonts/)
