# LiveWords UI/UX Design Specification

## 1. Product & Design Overview

- **Product**: LiveWords – AI‑powered English vocabulary learning for Chinese users, delivered as a WeChat mini program.
- **Core value**: Short, focused word sessions (New + Review) + AI paragraphs that contextualize all learned words.
- **Primary devices**: Modern iOS/Android phones, portrait only.
- **High‑level requirement**: Completely new UI that:
  - Is bright, light, playful, minimal, and “high‑end”.
  - Has very short, smooth user paths.
  - Is fully implementable with standard WeChat mini program components and animations.

---

## 2. Design Goals

- **Bright & uplifting**: Light backgrounds, fresh accent colors, lots of white space; no dark/neon/cyberpunk look.
- **Minimal & calm**: Few elements per screen, clear hierarchy, no dense ornaments.
- **Fast path to learning**:
  - First‑time: Welcome → Login → Main Home → First Session in 1–2 taps.
  - Returning: App open → Main Home → Session in 1 tap.
- **Discoverable interactions**: All critical actions visible as buttons/toggles; gestures only as enhancement.
- **Consistent system**: Reusable components and patterns across screens (cards, chips, sliders, tabs).
- **WeChat‑ready**: Layouts and interactions must be achievable with `view`, `text`, `image`, `button`, `scroll-view`, `swiper`, sliders, tabs, and basic animations.

---

## 3. Visual Language

### 3.1 Color System (Conceptual)

_Exact hex values can be tuned later; below are example directions._

- **Backgrounds**
  - `BG/Main`: Very light warm grey or off‑white (e.g., `#F6F7FB`).
  - `BG/Card`: Pure white (`#FFFFFF`).
  - `BG/Overlay`: White at 92–96% opacity on top of dimmed background.

- **Primary accents**
  - `Primary`: Turquoise/teal (e.g., `#23C4C9`) – main CTAs, active states.
  - `Primary Soft`: Light teal tint (e.g., `#E1F8F9`) – subtle highlights.

- **Secondary accents**
  - `Secondary`: Sky blue (e.g., `#4C8DFF`) – secondary CTAs, progress, links.
  - `Highlight`: Soft coral (e.g., `#FF7A6E`) – emphasis, streak badges.

- **Neutrals**
  - `Text/Primary`: Dark slate (`#1E2433`).
  - `Text/Secondary`: Mid grey (`#6E7484`).
  - `Border/Light`: `#E1E4EC`.

- **Semantic**
  - `Success`: Soft green (`#37C985`).
  - `Warning`: Amber (`#FFC857`).
  - `Error`: Red (`#F45B5B`).

**Usage principles**

- Keep large surfaces in `BG/Main` or white.
- Use accents sparingly on buttons, chips, progress.
- Avoid full‑screen gradients; at most subtle gradients for hero areas.

### 3.2 Typography

- **Font family**: Modern sans‑serif (system: SF Pro / PingFang / Roboto).
- **Roles**
  - `H1`: 24–28pt, bold – screen titles (e.g., “LiveWords”, “Session complete”).
  - `H2`: 20–22pt, semi‑bold – key numbers (e.g., “20 words today”).
  - `Body`: 14–16pt, regular – copy and labels.
  - `Caption`: 12–13pt, regular – helper text, tags, metadata.
- **Line height**
  - Titles ~120%, body ~140–150% for paragraphs.

### 3.3 Shapes, Elevation & Iconography

- **Shapes**
  - Cards: 16–24rpx radius.
  - Buttons: pill‑shaped (full rounding).
  - Chips: fully rounded with subtle border.

- **Elevation**
  - Level 0: flat.
  - Level 1: card shadow (soft, ~2–4dp).
  - Level 2: elevated surfaces like bottom sheets (~6dp).

- **Iconography**
  - Simple outline/duotone icons, consistent stroke width.
  - Occasional light illustrations for empty/loading states.

---

## 4. Layout System

- **Grid**
  - Single‑column mobile layout.
  - Content width ~88–92% of screen.
  - Horizontal padding: 24–32rpx.

- **Vertical rhythm**
  - Section spacing: 24–32rpx.
  - Intra‑component spacing: 8–16rpx.

- **Safe areas**
  - Respect status bar and mini‑program nav.
  - Custom top bars must avoid notches.

---

## 5. Interaction Model & Navigation

- **Navigation paradigm**
  - Stack navigation:
    - `Welcome` → `Main Home`.
    - `Main Home` → `Word Session`.
    - `Word Session` → `Session Completion` → `AI Paragraph`.
    - `Main Home` → `Settings & Profile`.
  - Use default back arrow on sub‑screens.

- **Global access**
  - Settings/Profile entry always visible on Main Home (avatar or gear).

- **Gestures**
  - Word card horizontal swipe as secondary input; visible buttons as primary.

---

## 6. Key Product Logic & Flows

### 6.1 Product Logic (Context for UX)

- **Modes**
  - **New Words**: Introduce new vocabulary, avoiding words in the user’s avoid list (known + recently seen).
  - **Review**: Revisit words previously marked as known.

- **Word data**
  - Per word: spelling, phonetic, Chinese translation, POS, list of meanings, example sentence.
  - User‑word status: `known`, `unknown/learning`, `banned` (future).
  - Metrics: exposures, familiarity, firstSeenAt, lastSeenAt, optional nextReviewAt.

- **AI generation**
  - App sends deck info + target count + mode + JSON context (`avoidWords[]` or `reviewWords[]`, and ordering preferences).
  - AI returns JSON:
    - `words[]` (word, phonetic, translation, `cn_defs`, example).
    - `paragraph.english` and `paragraph.mixed`.
  - Client normalizes data and highlights session words in the English paragraph.

- **Profile & stats**
  - Per user (openid): `settings` (dailyNewCount, reviewModeDefault, orderMode, orderAlphaLetter, selected deck) and `counters` (known, reviewable, totalLearned).
  - `createdAt` used to compute study days.

### 6.2 Onboarding & Authentication Flow

1. Open mini program.
2. **Welcome Screen**:
   - Explanation + “WeChat One‑Tap Login”.
3. On success:
   - Initialize / load profile from cloud.
   - Navigate to **Main Learning Home** with recommended deck, daily count, default mode.

### 6.3 Daily Entry (Returning User)

1. Open app:
   - If authenticated → **Main Learning Home**.
2. Home shows:
   - Today’s goal (e.g., `0 / 20`).
   - Active deck.
   - Current mode (New / Review).
   - Primary CTA `Start Session`.
3. One tap → **Word Session Screen**.

### 6.4 New Words Session Flow

1. From Main Home in New Words mode, tap `Start Session`.
2. **Word Session**:
   - Focused word card.
3. For each word:
   - Tap `"I know this"` or `"Review later"` (or swipe right/left).
4. Progress updates.
5. When all words known:
   - Transition to **Session Completion / AI Paragraph**.

### 6.5 Review Session Flow

1. On Main Home, toggle mode to `Review`.
2. `Start Session` → Review session.
3. UI indicates Review mode (badge/accent).
4. Mark words as “forgotten” (treated like `Review later` or dedicated action).
5. Completion → **Session Completion** labeled as “Review”.

### 6.6 Completion & Paragraph Flow

1. Completion header summarises:
   - Mode, number of words, streak snippet.
2. Scroll to AI Paragraph section:
   - Tabs for `English Only` / `Mixed Bilingual`.
   - Paragraph text, with vocabulary words highlighted.
3. Actions:
   - `Copy paragraph`.
   - `Start New Session`.
   - `Switch mode`.
   - `Back to Home`.

### 6.7 Settings & Deck Management Flow

1. On Main Home, tap avatar/gear → **Settings & Profile**.
2. Sections:
   - Profile summary.
   - Learning stats.
   - Learning plan (daily count, default mode, word order).
   - Deck Library.
3. All changes auto‑save to cloud.
4. Back to Main Home:
   - Deck / dailyGoal / defaultMode updated for next sessions.

---

## 7. Screen‑by‑Screen Design

### 7.1 Welcome / Authorization Screen

**Purpose**  
Introduce LiveWords, build trust, trigger login.

**Layout**

- **Top**
  - Logo (word bubble + spark).
  - `H1`: “LiveWords”.
  - Short tagline: “AI‑powered English vocabulary micro‑sessions”.

- **Middle – Value**
  - 3 icon+text bullets:
    - “Personalized AI word sets”.
    - “Smart review, avoid repetition”.
    - “Cloud‑synced progress”.

- **CTA**
  - Primary pill button:
    - Label: “WeChat One‑Tap Login”.
    - Left icon: WeChat.
  - Caption:
    - “By continuing you agree to the Terms & Privacy Policy.”

- **Bottom**
  - (Optional) secondary text link: “Continue without sync”.
  - Error message area.

**Interactions**

- Tap primary → `wx.getUserProfile` → on success → init profile → Main Home.
- On failure → inline error above button.

---

### 7.2 Main Learning Home (Dashboard)

**Purpose**  
Show plan for today and allow one‑tap start; entry to Settings.

**Layout**

- **Top bar**
  - Left: logo or text “LiveWords”.
  - Right: circular avatar → Settings & Profile.

- **Section 1 – Today Panel**
  - Card:
    - Left:  
      - `H2`: “Today’s goal”.  
      - `Body`: “0 / 20 words”.
    - Right: streak chip (e.g., “12‑day streak”) if applicable.
  - Linear progress bar below.

- **Section 2 – Mode & Deck**
  - Segmented control:
    - “New Words” / “Review”.
  - Deck chip:
    - “Deck: IELTS Core”.
    - Subtitle: “Academic · Exam · 6.5+”.
    - Right chevron.

- **Section 3 – Primary Action**
  - Full‑width primary pill:
    - “Start Session”.
    - Optional small text: “~10 minutes”.

- **Section 4 – Quick Summary**
  - 3 small cards:
    - Known words.
    - Ready to review.
    - Total learned.

**Empty State**

- Illustration + text: “No stats yet – start your first LiveWords session”.
- CTA: “Start first session”.

**Interactions**

- Avatar → Settings & Profile.
- Deck chip → deck picker or Deck Library section.
- Mode toggle → immediate visual update.
- Start Session → Word Session screen.

---

### 7.3 Word Card Session Screen

**Purpose**  
Fast, focused marking of word status.

**Layout**

- **Top bar**
  - Back arrow → confirm if leaving mid‑session.
  - Title: “New Words – IELTS Core” or “Review – Business”.
  - Optional `…` menu.

- **Progress row**
  - Text: “5 / 20 words”.
  - Linear progress bar.

- **Main card**
  - Centered card:
    - `H1`: word (e.g., “ubiquitous”).
    - Phonetic: `/juːˈbɪkwɪtəs/`.
    - Short Chinese translation.
    - POS pill: “adj.”.
    - “Show more meanings & example” row with chevron.

- **Expanded details**
  - When tapped:
    - List of meanings (bullets).
    - Example sentence (EN + CN).

- **Action row**
  - Two large pills:
    - Left (outline, warm accent): “Review later”.
    - Right (filled teal): “I know this”.
  - Small label: “You can also swipe left/right”.

**Gestures**

- Swipe right → “I know this”.
- Swipe left → “Review later”.
- Show temporary overlays “Known” / “Review”.

**Error state**

- Message: “Couldn’t load words. Tap to retry.” with light button.

---

### 7.4 Session Completion + AI Paragraph Screen

**Purpose**  
Celebrate completion, show context, and guide next action.

**Layout**

- **Header**
  - Icon (confetti/check).
  - `H1`: “Session complete!”.
  - `Body`: “You’ve learned 20 words today” or “Reviewed 15 words”.

- **Stats chips**
  - “Total known: 450”.
  - “Streak: 12 days”.
  - “Mode: New Words” / “Review”.

- **Tabs**
  - Segmented control:
    - “English Only”.
    - “Mixed Bilingual”.

- **Paragraph card**
  - Scrollable text:
    - All session words highlighted (bold + teal).
    - Mixed variant uses Chinese sentences with English words inline.

- **Actions**
  - Text button: “Copy paragraph”.
  - Primary pill: “Start New Session”.
  - Secondary outline: “Switch to Review/New mode”.
  - Small text: “Back to Home”.

**Interactions**

- Tab switch → cross‑fade between paragraphs.
- Copy → show “Copied” toast.
- Start New Session → new session (same mode+deck).
- Back to Home → Main Home.

---

### 7.5 Settings & Profile Screen

**Purpose**  
Central place for stats and configuration.

**Layout**

- **Top bar**
  - Back arrow.
  - Title: “Profile & Settings”.

- **Section 1 – Profile**
  - Card:
    - Avatar.
    - Nickname (H2).
    - Caption: “LiveWords member since 2025‑01‑13”.
    - Chip: “12‑day streak”.

- **Section 2 – Learning Stats**
  - 2×2 grid of cards:
    - Known words.
    - Ready to review.
    - Total learned.
    - Study days / longest streak.

- **Section 3 – Learning Plan**
  - **Daily new words**
    - Label + numeric value (“30 words/day”).
    - Slider (5–100).
  - **Default launch mode**
    - Label: “When I open LiveWords”.
    - Segmented control: “New Words” / “Review”.
  - **Word order**
    - Label: “Word order in sessions”.
    - Segmented control: “Alphabetic” / “Similar” / “Shuffle”.
    - If “Alphabetic”:
      - Row of A–Z chips for starting letter.

- **Section 4 – Deck Library**
  - Title: “Deck library”.
  - Scrollable deck cards:
    - Title: “IELTS Core”.
    - Description: “Academic reading · 6.5+”.
    - Tags: “Exam”, “Academic”.
    - Badge: “Selected” for active deck.

- **Section 5 – Misc**
  - Links:
    - “About LiveWords”.
    - “Send feedback”.
    - “Log out” (if needed).

**Interactions**

- All controls auto‑save to cloud.
- Deck tap → card highlight + toast “Deck switched to …”.
- Back → Main Home reflects updated deck, dailyGoal, defaultMode.

---

### 7.6 Supporting States

- **Loading overlay**
  - Semi‑transparent white.
  - Spinner + text: “AI is preparing your words…”.

- **Empty state (Main Home)**
  - Illustration (books / word bubble).
  - Text: “No stats yet – start your first LiveWords session”.
  - CTA: “Start first session”.

- **Error state**
  - Card with icon ⚠️.
  - Text: “We couldn’t load your session. Please check your network and try again.”
  - Button: “Retry”.

---

## 8. Component Specifications

### 8.1 Buttons

- **Primary**
  - Full‑width pill, filled `Primary`.
  - Text: white.
  - Shadow: medium.
  - For main actions: login, start session, start new session.

- **Secondary**
  - Outline with `Primary` border, white background.
  - For alternative positive actions (switch mode, review words).

- **Tertiary**
  - Text‑only, `Secondary` color.
  - For navigation links.

- **Destructive**
  - Filled `Error`, only when necessary (e.g., reset).

States: default, pressed (darker & slightly scaled), disabled (lower opacity).

### 8.2 Segmented Controls / Tabs

- Container: pill with 2–3 segments.
- Active segment:
  - `Primary` background, white text.
- Inactive:
  - Transparent, light border, `Text/Secondary` text.

Used for:

- New vs Review.
- English vs Mixed paragraph.
- Default launch mode.
- Word order.

### 8.3 Chips

- Small pill with label (and optional icon).
- **Filter chip**:
  - Border + neutral text; active: `Primary Soft` background, `Primary` text.
- **Status chip**:
  - Filled with accent color, white text (streak, selected deck).

### 8.4 Slider

- Track: light grey.
- Active track: `Primary`.
- Thumb: circular with subtle shadow.
- Numeric value label near slider.

### 8.5 Cards

- Background: white, rounded corners, subtle shadow.
- Padding: 16–20rpx.
- Variants:
  - Word card (large, central).
  - Stats cards (small, grid).
  - Deck cards (include title, description, tags).

---

## 9. Motion & Micro‑Interactions

- **Page transitions**
  - Consistent slide‑in/out.

- **Word card swipe**
  - Horizontal movement with easing.
  - Underlay color + “Known” / “Review later” labels.

- **Buttons**
  - Scale down ~2–3% on press, shadow shrinks.

- **Progress bar**
  - Smooth animation when percentage changes.

Animations must remain subtle and performant.

---

## 10. Implementation Notes (WeChat Mini Program)

- Use `scroll-view` for:
  - Settings & Profile.
  - AI paragraphs.
- `swiper` is optional; primary navigation via taps.
- Respect safe area and mini‑program nav bar in custom headers.
- Use vector or high‑res PNG icons.
- Define font sizes in `rpx`; ensure body text is comfortably readable.
- Test with mixed Chinese/English content to ensure line breaks and highlighting look good.

---

