# somm design system

A quiet, compact desktop interface inspired by Raycast: layered neutral surfaces, clear typography, restrained borders, and a wine accent. The ui-ux-pro-max design-system search for developer tools informed the dark developer-tool direction and accessibility checks; the product brief overrides its suggested colors and light-mode recommendation. Avoid decorative glow and remote font dependencies.

## Tokens

| Role | Dark | Light |
| --- | --- | --- |
| Background | `#151416` | `#f6f4f5` |
| Surface | `#201e21` | `#ffffff` |
| Raised | `#2c292d` | `#ede9eb` |
| Foreground | `#f5f2f4` | `#251f23` |
| Muted text | `#c0b9bf` | `#625860` |
| Border | `#514b51` | `#aaa0a6` |
| Accent | `#8b1e3f` | `#8b1e3f` |
| Focus | `#ed9ab2` | `#8b1e3f` |
| Grade A | `#8fddb2` | `#17683e` |
| Grade B | `#a7d6e9` | `#165e7c` |
| Grade C | `#f0d38c` | `#725300` |
| Grade D | `#ffb38b` | `#93410f` |
| Grade F | `#ffa5ae` | `#9c2438` |

Use semantic CSS variables and Tailwind `@theme inline` mappings. Dark is the default; setting `data-theme="light"` on the root selects light. The app theme setting persists the selection locally and applies that attribute at startup. Use system sans for UI and system monospace for verdicts and code. Normal text should meet 4.5:1 contrast; do not communicate grade or verdict by color alone.

## Spacing and shape

Use a 4 px base: 4, 8, 12, 16, 24, 32, 48 px. Use 8–16 px within controls, 24 px card padding, and 32 px between major sections. Controls use 8 px radii, cards and dialogs 12 px, and badges a pill. Use subtle elevation only for overlays.

## Components

- **Button:** primary for the main action; secondary and ghost for supporting actions; danger for destructive actions with explicit text. Use real disabled semantics, visible focus, and at least 40 px height.
- **Badge / GradeBadge:** concise text labels. Grades A–D describe static findings; F is reserved for confirmed dynamic evidence. Include the letter and accessible label.
- **SommTag:** monospace verdict text: `// somm: pairs well`, `// somm: needs to breathe`, `// somm: corked`. Pair color with the words.
- **Card:** surface, border and consistent padding; the caller supplies semantic content and actions.
- **Tabs:** labelled tablist, selected state, arrow/Home/End keyboard navigation. The caller supplies IDs for tabs and corresponding tab panels, and associates each panel with its tab.
- **Dialog:** native modal dialog, accessible title, close control and Escape support. Caller supplies the content and controls open state.
- **Toast:** status for routine updates, alert for urgent security messages; keep text actionable and do not rely solely on color.
- **Spinner:** accessible loading status with a caller-provided localized label. Use a progress bar when progress is known.

All interactive controls need accessible names, visible keyboard focus, hover and disabled states. Respect reduced-motion preferences. UI copy belongs to the existing i18n system; consumers must localize labels and dialog titles.
