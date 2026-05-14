---
name: OpenCode Trace Viewer
description: Trace data viewer with terminal-native aesthetic
colors:
  warm-ink: "#201d1d"
  soft-cream: "#fdfcfc"
  ash-gray: "#9a9898"
  dark-surface: "#302c2c"
  light-surface: "#f1eeee"
  signal-blue: "#007aff"
  signal-blue-hover: "#0056b3"
  signal-blue-active: "#004085"
  alert-red: "#ff3b30"
  alert-red-hover: "#d70015"
  alert-red-active: "#a50011"
  success-green: "#30d158"
  caution-orange: "#ff9f0a"
  caution-orange-hover: "#cc7f08"
  caution-orange-active: "#995f06"
  muted-gray: "#6e6e73"
  input-bg: "#f8f7f7"
typography:
  display:
    fontFamily: "'Berkeley Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "38px"
    fontWeight: 700
    lineHeight: 1.5
  headline:
    fontFamily: "'Berkeley Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "'Berkeley Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-medium:
    fontFamily: "'Berkeley Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "'Berkeley Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 2
rounded:
  sm: "4px"
  input: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
  xxxl: "64px"
  hero: "96px"
components:
  button-primary:
    backgroundColor: "{colors.warm-ink}"
    textColor: "{colors.soft-cream}"
    rounded: "{rounded.sm}"
    padding: "4px 20px"
  button-primary-hover:
    backgroundColor: "{colors.dark-surface}"
  input-text:
    backgroundColor: "{colors.input-bg}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.input}"
    padding: "20px"
---

# Design System: OpenCode Trace Viewer

## 1. Overview

**Creative North Star: "The Debug Console"**

Analogous to a profiler or debugger: function-first, no marketing decoration, trustworthy accuracy. Every element serves the workflow, not the aesthetic.

The visual system is built on warm minimalism: a near-black background (`#201d1d`) with subtle reddish-brown warmth, paired with soft off-white text (`#fdfcfc`). Not a sterile cold dark theme, nor a playful one. Cohesive and intentional. Berkeley Mono is the sole typeface, creating a unified "everything is code" philosophy where hierarchy is achieved through weight and scale alone, not font variation.

Flat by design. Depth is conveyed through border treatments and background color shifts, never shadows. This flatness mirrors terminal aesthetics: terminals don't have shadows, and neither does this viewer.

**Key Characteristics:**
- Berkeley Mono as the sole typeface, no fallback to sans-serif
- Warm near-black primary (`#201d1d`) with reddish-brown undertone
- Soft off-white text (`#fdfcfc`) with warm tint
- Minimal 4px border radius throughout, 6px for inputs
- 8px spacing grid scaling to 96px
- Apple HIG semantic colors (blue, red, green, orange)
- Flat elevation: no shadows, borders only

## 2. Colors

The palette is deliberately minimal: three functional tones carry the surface, semantic colors borrow from Apple HIG for familiarity and trustworthiness.

### Primary
- **Warm Ink** (`#201d1d`): Primary background, button fills, link text. A near-black with subtle reddish-brown warmth, rgb(32, 29, 29).
- **Soft Cream** (`#fdfcfc`): Primary text on dark surfaces, button text. A barely-warm off-white that avoids clinical pure white.
- **Ash Gray** (`#9a9898`): Secondary text, muted links. A warm gray that bridges dark and light.

### Secondary
- **Dark Surface** (`#302c2c`): Slightly lighter than primary, used for elevated surfaces and hover states.
- **Light Surface** (`#f1eeee`): Light mode surface variation.
- **Input Background** (`#f8f7f7`): Form fields, light neutral for typing comfort.

### Accent
- **Signal Blue** (`#007aff`): Primary accent, links, interactive highlights. Apple system blue.
- **Signal Blue Hover** (`#0056b3`): Darker for hover states.
- **Signal Blue Active** (`#004085`): Deepest for pressed states.

### Semantic
- **Alert Red** (`#ff3b30`): Error states, destructive actions. Apple system red.
- **Success Green** (`#30d158`): Success states, positive feedback.
- **Caution Orange** (`#ff9f0a`): Warning states, caution signals.

### Neutral
- **Muted Gray** (`#6e6e73`): Muted labels, disabled text, placeholder content.

**The One Voice Rule.** The color palette is deliberately restrained. Primary and neutral tones carry 90%+ of the surface. Accent and semantic colors appear only where they signal meaning, not decoration.

## 3. Typography

**Font Family:** Berkeley Mono everywhere, with fallbacks to IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New.

**Character:** One font, one voice. No sans-serif fallback, no serif accents. Everything speaks in the same monospace register.

### Hierarchy
- **Display** (weight 700, 38px, line-height 1.5): Hero headlines, page titles.
- **Headline** (weight 700, 16px, line-height 1.5): Section titles, bold emphasis.
- **Body** (weight 400, 16px, line-height 1.5): Standard text, paragraphs. Cap at 65–75ch.
- **Body Medium** (weight 500, 16px, line-height 1.5): Links, button text, nav items.
- **Caption** (weight 400, 14px, line-height 2): Footnotes, metadata, small labels.

**The Weight Hierarchy Rule.** 700 for headings, 500 for interactive emphasis, 400 for body. Three weight levels create the entire hierarchy. Never introduce a second font family.

## 4. Elevation

Flat by design. No shadows anywhere in the system. Depth is communicated exclusively through:

1. **Border treatments** — transparent warm (`rgba(15, 0, 0, 0.12)`) for subtle, solid gray (`#646262`) for emphasis
2. **Background shifts** — `#201d1d` to `#302c2c` for surface differentiation
3. **Opacity variations** — `rgba(253, 252, 252, 0.04)` to `0.08` for hover states

**The Flat-By-Default Rule.** Surfaces are flat at rest. No elevation illusion, no ambient shadows. Hover and focus use opacity or border shifts, not lift.

## 5. Components

### Buttons
- **Shape:** Minimal rounded corners (4px radius)
- **Primary:** Warm Ink background, Soft Cream text, padding 4px 20px, weight 500
- **Hover:** Background shifts to Dark Surface (`#302c2c`)
- **Focus:** Border color shift, no shadow rings

### Inputs
- **Shape:** Slightly rounder (6px radius) for typing comfort
- **Style:** Input Background (`#f8f7f7`), Warm Ink text, warm transparent border
- **Focus:** Border opacity increase, no glow
- **Padding:** Generous 20px for comfortable mobile typing

### Links
- **Default:** Warm Ink color, underlined, weight 500
- **On dark backgrounds:** Soft Cream color, no underline
- **Hover:** Signal Blue color shift

### Navigation
- **Style:** Horizontal layout, Berkeley Mono throughout
- **Links:** 16px weight 500, underline decoration
- **Background:** Solid Warm Ink, no blur or transparency

### Cards / Containers
- **Corner Style:** Minimal 4px radius
- **Background:** Dark Surface for elevated content
- **Border:** Warm transparent (`rgba(15, 0, 0, 0.12)`), not side-stripes
- **Shadow:** None, flat always

### Tabs
- **Active indicator:** 2px solid bottom border in Ash Gray
- **Font:** 16px weight 500, tight line-height 1.0

## 6. Do's and Don'ts

### Do:
- **Do** use Warm Ink (`#201d1d`) for backgrounds, never pure black (`#000000`)
- **Do** use Soft Cream (`#fdfcfc`) for text on dark, never pure white (`#ffffff`)
- **Do** maintain the 8px spacing grid: 8, 16, 24, 32, 48, 64, 96px
- **Do** keep surfaces flat: borders and background shifts only, no shadows
- **Do** use Berkeley Mono exclusively, weight and scale carry hierarchy
- **Do** place accent colors only where they signal meaning, not decoration
- **Do** cap body line length at 65–75ch for readability

### Don't:
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe on cards, list items, or alerts
- **Don't** use gradient text (`background-clip: text` with gradient background)
- **Don't** apply glassmorphism, blur effects, or backdrop-filter decoratively
- **Don't** create hero-metric templates (big number, small label, gradient accent)
- **Don't** build identical card grids with same-sized cards repeated endlessly
- **Don't** introduce sans-serif or serif typefaces alongside Berkeley Mono
- **Don't** use rounded pills or large radii beyond 6px
- **Don't** use shadows for elevation or hover states
- **Don't** present raw data dumps without hierarchy — always structure from overview to detail