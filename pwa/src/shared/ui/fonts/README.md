# Terminal icon faces

Prompts, file listings and status lines on the computer use icon glyphs from
[Nerd Fonts](https://www.nerdfonts.com/). They live in the Unicode private use
areas, so no phone, tablet or browser has them. These two files carry them, each
under a family of its own; the `@font-face` rules are in `icon-font.css`, which
also says why the families are named only in the terminal views.

| File | Code points | Glyphs |
| --- | --- | --- |
| `symbols-nerd-font-bmp.woff2` | U+E000–F8FF, plus the power symbols U+23FB–23FE and U+2B58 | 3719 |
| `symbols-nerd-font-mdi.woff2` | U+F0001–F1AF0 (Material Design Icons) | 6896 |

Neither file is part of the application's startup or offline closure
(`scripts/performance-budget.ts`). A browser fetches one the first time a
terminal view shows a glyph from its range, and the service worker keeps it.

## Source

Nerd Fonts v3.5.1, `SymbolsNerdFont-Regular.ttf` from

```
https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.tar.xz
sha256 01172f37db8543edb102e5cb5c64101c9f4686630804d49b419aa07b23a69996
```

The variable-width face, not `SymbolsNerdFontMono`: its glyphs start at the left
edge of their box, which is where a terminal cell draws them.

## Rebuild

With fonttools 4.40 and brotli:

```
pyftsubset SymbolsNerdFont-Regular.ttf --unicodes="U+23FB-23FE,U+2B58,U+E000-F8FF" \
  --flavor=woff2 --no-hinting --output-file=symbols-nerd-font-bmp.woff2
pyftsubset SymbolsNerdFont-Regular.ttf --unicodes="U+F0000-FFFFD" \
  --flavor=woff2 --no-hinting --output-file=symbols-nerd-font-mdi.woff2
```

After a rebuild, the ranges in `icon-font.css` and `term-glyphs.ts` must still
match what the files contain; `term-glyphs.font.test.ts` reads the files and
checks both.

## Licence

Nerd Fonts itself is MIT licensed (`LICENSE-nerd-fonts.txt`, copyright Ryan L
McIntyre). The glyphs come from the icon sets it collects, each under its own
licence, as its audit for this release lists them
(<https://github.com/ryanoasis/nerd-fonts/blob/v3.5.1/license-audit.md>):

| Icon set | Licence |
| --- | --- |
| Codicons | CC BY 4.0 |
| Devicons | MIT |
| Font Awesome | CC BY 4.0 |
| Font Awesome Extension | MIT |
| Font Logos | Unlicense |
| IEC Power Symbols | MIT |
| Material Design Icons | Apache 2.0 |
| Seti-UI (modified) | MIT |
| Octicons | MIT |
| Pomicons | SIL OFL 1.1 |
| Powerline Extra Symbols | MIT |
| Powerline Symbols | free licence |
| Weather Icons | SIL OFL 1.1 |

The two files are subsets of the release's own face with hinting removed and
nothing redrawn; the copyright record in each is the release's. The repository's
`NOTICE` names them.
