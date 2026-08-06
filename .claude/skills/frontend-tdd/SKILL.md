# Frontend TDD Coding Skill

Invoke before writing any frontend React/TypeScript code. Enforces component-driven TDD with project-specific constraints.

The browser surface is `apps/web/` (TanStack Start + Tailwind v4); the legacy `frontend/` package was retired (#537). Commands run from `apps/web/`.

## TDD Cycle

### 1. RED — Write failing test first

```bash
cd apps/web && pnpm exec vitest run --config vitest.config.ts tests/unit/<component>.test.tsx --reporter verbose
```

- Test name: `"<verb>s <what> when <condition>"` (e.g., `"renders welcome screen when no messages"`)
- Test user-visible behavior, not implementation details
- Query by role/label/text, not by CSS class or test-id

### 2. GREEN — Minimal code to pass

Write the smallest component code that makes the test green.

```bash
cd apps/web && pnpm exec vitest run --config vitest.config.ts tests/unit/<component>.test.tsx --reporter verbose
```

### 3. REFACTOR — Clean up with tests green

```bash
cd apps/web && pnpm run typecheck && pnpm run lint:oxlint && pnpm run build
```

## Enforced Limits (apps/web/.oxlintrc.json)

- Production functions: max 10 lines; test code: max 50 lines.
- Violations fail CI (`--deny-warnings`). Extract, don't suppress.

## Code Constraints

### Component Design
- One responsibility per component. State + render + fetch → split into container + presenter.
- Max 5 props. More than 5 → group into a config object or use context.
- TanStack file routes in `src/routes/`; router created in `src/router.tsx`.
- `src/routeTree.gen.ts` is generated — never hand-edit (oxlint/coverage ignore it).

### Styling — Design Tokens Only
- Semantic tokens in `src/styles/globals.css`: `bg-[var(--color-card)]`, `bg-[var(--color-primary)]`, `text-[var(--color-fg)]` — not `bg-white` / `bg-gray-*` / hardcoded hex.
- Inline `style={}` only for truly dynamic values (animation delays, computed positions).
- Conditional classes via template literals (there is no `cn()` helper in this app).

### State Management
- Props for 1-2 levels of passing. Context for 3+.
- Extract complex state into custom hooks (`useChat`, `useSession`, `useDict`).
- Callbacks passed through 3+ levels → create a context instead.

### i18n
- All user-facing strings via `useDict()` from `src/i18n/LocaleProvider.tsx`. No hardcoded English.

### Naming
- Components: PascalCase (`ChatPanel`) · Hooks: `use` prefix (`useMediaQuery`)
- Event handlers: `handle` prefix in component, `on` prefix in props
- Boolean props: `is`/`has`/`should` prefix (`isMobile`, `hasMessages`)

## Test Constraints

### Query Priority (from Testing Library best practices)
1. `getByRole` — accessible roles (button, heading, textbox)
2. `getByLabelText` — form elements
3. `getByText` — visible text content
4. `getByTestId` — LAST resort only

### DO NOT test implementation
- DO NOT assert on CSS classes or internal state — test what the user sees.
- DO assert on: visible text, accessible roles, user interactions, callback invocations.

### Interactions
- Every component with buttons/inputs MUST have interaction tests (`fireEvent`/`userEvent`).
- Verify callback args: `expect(onSend).toHaveBeenCalledWith("query")`.

### Mocking
- API via MSW swimlanes in `tests/msw/`: `node.ts` (component/loader unit tests), `browser.ts` (client navigation). Handlers parse against `@animichi/contract` schemas.
- Mock hooks only when the component USES the hook, not the hook itself.
- More than 5 mocks in one test → the component is too coupled; refactor first.

### Assertions
- Use `toBeInTheDocument()` not `.not.toBeNull()`
- Use `toHaveTextContent("expected")` not `textContent.includes("expected")`
- Use `toHaveBeenCalledWith(args)` not `toHaveBeenCalled()`

### Organization
- One test file per component file; max 200 lines per test file.
- `describe` blocks group by feature, not by method; `it.each()` for parameterized tests.
- Factory helpers for test data (`makePoint()`, `makeMessage()`).

## Anti-Patterns (from audit — DO NOT introduce)

| Anti-Pattern | Example | Fix |
|---|---|---|
| God component | AuthGate at 465 lines | Split into container + presenter |
| Duplicated JSX | Timeline rendered twice (desktop + mobile) | Extract TimelineView component |
| Prop drilling | onSuggest through 3 levels | Create SuggestContext |
| Excessive mocking | 12 mocks in one test | Refactor component to be testable with fewer deps |
| CSS class assertion | `className.includes("bg-primary")` | Test visible state: `toHaveAttribute("aria-pressed")` |
| Missing interactions | Only render tests, no click/type tests | Add fireEvent/userEvent tests |
| Hardcoded i18n | English strings inline | `useDict()` from `src/i18n/LocaleProvider.tsx` |
| Conditional test logic | `if (img) { fireEvent... }` | Assert img exists, then interact |
| Nested ternaries in JSX | `locale === "ja" ? ... : locale === "zh" ? ...` | Extract to helper function |
