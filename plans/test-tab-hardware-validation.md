# Test Tab for Hardware Validation

## Goal
Create a dedicated Test tab in the Empyrean Gate UI for validating hardware connections with simple controls for testing colors, brightness, pixel selection, and sACN listener detection.

## Implementation Details

### Files Created/Modified
- **Created**: `src/Test.tsx` — Main Test tab component
- **Modified**: `src/App.tsx` — Added Test tab to navigation
- **Modified**: `src/styles.css` — Added CSS styling for test page

### Components

#### Test Tab (`src/Test.tsx`)
Main component that provides:

1. **Test Mode Toggle**
   - Explicit checkbox to enable test mode (mode must be deliberately entered)
   - Prevents accidental triggering of test operations

2. **Color & Brightness Controls** (when test mode enabled)
   - Native HTML color picker for color selection
   - Hex color display alongside picker
   - Brightness slider (0-100%)
   - Throttled brightness updates to avoid overwhelming the backend
   - "Send Test Pattern" button that triggers a burst effect with selected HSB values

3. **Pixel Selection** (when test mode enabled)
   - Three selection modes: Front Half, Back Half, All Pixels
   - Pixel index slider (adaptive range based on selected mode)
   - Real-time display of:
     - Absolute pixel index
     - Spoke number
     - Position within spoke

4. **sACN Listener Detection** (when test mode enabled)
   - Expandable/collapsible panel
   - Lists expected Pixlites from configuration
   - Shows universe range for each controller
   - Transmission stats:
     - sACN enabled status
     - Active universes
     - Packets per second
   - Displays sACN errors if present

### Key Features

- **Safe by Default**: Test mode is off until explicitly toggled
- **Real-time Feedback**: All controls show live values and status
- **HSB Color Model**: Converts hex colors to HSB for backend effect triggering
- **Geometry Awareness**: Uses actual geometry config (spokes, pixels per spoke) for accurate pixel selection
- **sACN Integration**: Reads from backend status to show live listener activity
- **Throttled Updates**: Brightness changes throttled to ~10 msg/s to avoid flooding the backend

### Styling

All styling follows the existing Empyrean design system:
- Dark theme using CSS variables (--accent, --accent2, --muted, etc.)
- Panel-based layout consistent with Settings page
- Control groups for logical organization
- Status indicators with color coding (ok/danger/muted)
- Responsive grid layouts for different screen sizes

## Progress

- [x] Create Test component with test mode toggle
- [x] Implement color & brightness controls
- [x] Implement pixel selection with spoke/position info
- [x] Implement sACN listener detection panel
- [x] Add CSS styling
- [x] Update App.tsx to include Test tab
- [x] TypeScript validation passes

## Testing Checklist

When testing locally:
- [ ] Test tab appears in navigation
- [ ] Test mode toggle works
- [ ] Color picker changes display
- [ ] Brightness slider updates percentage
- [ ] Send Test Pattern button fires effect
- [ ] Pixel mode selection updates range
- [ ] Pixel index calculation is correct
- [ ] sACN panel shows expected Pixlites
- [ ] sACN stats update in real time
- [ ] Styling matches other tabs
- [ ] Responsive on mobile/tablet sizes

## Future Enhancements

Potential features for later:
- Per-spoke or per-pixel test patterns
- Animation controls (pulse, fade, etc.)
- Strand testing (all pixels on a single spoke)
- sACN listener discovery/ping functionality
- Test pattern library (rainbow sweep, sequential, etc.)
