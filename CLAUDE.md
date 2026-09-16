# Claude Code Instructions & Baseline Logic

Welcome to the 2026 RevOps AI Hackathon! Save this file as `claude.md` in your project's root directory. Claude Code will automatically read these instructions to understand the guardrails, baseline logic, and architectural rules for this event.

---

## 1. Default Technology Stack & Infrastructure
- **Strict Default:** Unless explicitly specified otherwise by the team, ALWAYS use **HTML, CSS, and vanilla JavaScript** to create the initial logic, structure, and styling. 
- **Simplicity First:** Do not generate complex backend systems, databases, or Next.js server components by default. 
- **Data Persistence:** If data needs to be saved (e.g., a scoreboard, form entries), default to using browser `localStorage`. 

## 2. Token Efficiency & Speed Optimization
To preserve token limits and ensure fast iteration:
- **Push as fast as possible.**
- **DO NOT write tests.** 
- **DO NOT run tests.** 
- Avoid generating long-winded explanations for standard boilerplate code. Provide direct, functional code snippets that the team can immediately test in the browser.
- Assume a single-machine, sequential Git workflow. Do not attempt to manage complex Git branching, merging, or CI/CD pipelines.

## 3. Architectural Enforcement (3-Tier Concept)
Even though we are building frontend-heavy applications, you must help the participants understand the conceptual **3-tier architecture** (Client/UI, Middleware/Logic, Backend/Data) they learned about in their briefings.
- Clearly separate your code output conceptually:
  - **Client/UI:** HTML and CSS structure.
  - **Logic/Middleware:** JavaScript functions handling user interactions and calculations[cite: 4].
  - **Data Layer:** Mock data stored in JSON files, retrieved via the `fetch()` API to simulate realistic backend calls without needing a true server (e.g., `fetch('./data/users.json')`). 
  **Crucial:** Static `.json` files in the browser are strictly **read-only**. Never attempt to write server-side Node.js or file-system (`fs`) code. All dynamic runtime updates or state persistence must save to `localStorage`.
- When providing code, briefly highlight which architectural layer the code belongs to so the non-technical participants can relate it to their training.

## 4. Upfront Controls & Pre-Approved Prompts
*Teams: Use the following prompts as a control mechanism to guide Claude effectively through your 30-minute time-boxed feature drops.*

- **Phase 1: Project Scaffold**
  > "We are starting our hackathon project. Based on the `claude.md` guidelines, generate our initial HTML, CSS, and JS files for a [describe your app/game]. Keep the architecture simple and use local storage if we need to save state."

- **Phase 2: Iterative Feature Drop**
  > "We need to execute a feature drop. Please add [Feature Name] to our existing application. Only provide the new or modified HTML/JS needed. Explain briefly which architectural layer these changes affect."

- **Phase 3: UI/UX Polish**
  > "Polish the user interface using modern design systems like Tailwind for rapid component styling. Whatever design system decided on, load them strictly via CDN script tags such as (`<script src="https://cdn.tailwindcss.com"></script>`). Do NOT introduce `npm`, PostCSS, CLI build tools, or terminal setup steps. Do not change the underlying JavaScript logic, only update the Client/UI layer."

- **Phase 4: Debugging (Without Tests)**
  > "We encountered an issue where [describe bug][cite: 4]. Following our token efficiency rules, do not write test scripts[cite: 1, 4]. Simply explain the error in plain English for a non-technical user and provide the exact HTML/JS fix[cite: 4]."


## 5. Repository Structure & File Rules
Maintain a clean project directory by adhering strictly to this layout:

- **Root Directory (`/`):** Contains only core application files (`index.html`, `style.css`, `app.js`) and `CLAUDE.md`.
- **Documentation (`/docs`):** Store all Product Requirement Documents (PRDs), feature drop specs, and planning notes here. Claude must check `/docs` for context when planning features.
- **Assets (`/assets`):** Store all static media here. 
  - Subfolder `/assets/images/` for graphics, icons, and screenshots.
  - Subfolder `/assets/audio/` for sound effects or media files.
- **Path Rules:** When generating HTML or CSS code referencing images or media, always use relative paths pointing to the `/assets/` directory.

## 6. HTML Meta Tags & SEO Prevention
To prevent accidental indexing of hackathon project code:
- **Required:** Always include the following meta tag in your `<head>`:
```html
  <meta name="robots" content="noindex, nofollow">
```
- This tells search engines not to index or follow links on your page — appropriate for temporary hackathon prototypes.
- **Optional:** For additional privacy control, add:
```html
  <meta name="googlebot" content="noindex, nofollow">
```

## 7. Cache Busting for CSS & JavaScript
To prevent browser caching from blocking your updates during rapid iteration:
- **Pattern:** Append a version query string to external asset links:
```html
  <link rel="stylesheet" href="style.css?v=001">
  <script src="app.js?v=001"></script>
```
- **When updating:** Increment the version number (`v=002`, `v=003`, etc.) to force browsers to re-download the file instead of using a cached copy.
- **Why:** During hackathon work, you'll make CSS and JS changes frequently. Without cache busting, your edits may not appear in the browser because it's serving an older cached version.
- **Shortcut:** Some teams use timestamps: `?v=20260908-1400` (date-time) or a build-time hash for production-grade setup. For this hackathon, simple incrementing numbers are fine.

## 8. Security & Data Protection
⚠️ **Critical:** Do not include confidential information in your hackathon code.

- **Never commit:**
  - Real API keys, authentication tokens, or secrets
  - Customer data, employee names, email addresses, or phone numbers (PII)
  - Company financial data, product roadmaps, or internal meeting notes
  - Database credentials or connection strings
  - Any proprietary or confidential business information

- **Why:** These are work machines on Personio's network. Code repositories (even hackathon projects) may be stored, reviewed, or shared. Accidental exposure of secrets or PII creates security and compliance risks.

- **Safe alternatives:**
  - Use placeholder data: `const mockUser = { id: 1, name: "Demo User", email: "demo@example.com" }`
  - Store real secrets in environment variables (never hardcoded) — and **do not commit those files**.
  - Reference dummy APIs or mock JSON files if you need realistic data patterns.

- **Rule of thumb:** If someone outside your team sees this code, would it harm Personio or a customer? If yes, don't include it.


## 9. External Libraries & Dependencies
By default, keep projects using **vanilla HTML, CSS, and JavaScript** as specified in Section 1.

**However, you may use external libraries at your discretion** — with these guardrails:

- **Allowed:** Well-established, widely-used libraries (jQuery, Chart.js, Lodash, Moment.js, etc.) from trusted sources like npm and CDN (cdnjs.cloudflare.com, unpkg.com, esm.sh).
- **Load via CDN:** Link libraries from a public CDN, not a local node_modules folder — keeps your project folder lean.
- **Vet before use:**
  - Check the library's maintenance status and community reputation.
  - Keep dependencies minimal — each library adds HTTP requests and bundle size.
  - If you're unsure about a library, ask the team.
- **No promotion:** We don't encourage external dependencies by default because they can complicate debugging and distract from the core logic you're building. Use them only if they genuinely solve a problem faster than writing vanilla code would.
- **Document your choice:** If you use an external library, add a comment in your HTML noting why and what version.

**Example:**
```html
<!-- Using Chart.js for advanced data visualization -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js?v=001"></script>
```
