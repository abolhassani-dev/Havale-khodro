# Frontend Structure

Feature-based architecture. Code that changes together lives together.

## The tree

```
frontend/
└── src/
    ├── components/   Shared presentational components, no business logic
    ├── layouts/      Page shells — sidebar, header, auth layout
    ├── pages/        Route-level entry points, thin
    ├── features/     Self-contained feature slices — the primary unit
    ├── hooks/        Shared React hooks
    ├── services/     Business logic and orchestration
    ├── api/          HTTP client, endpoint definitions, interceptors
    ├── contexts/     React contexts
    ├── providers/    Provider composition
    ├── store/        Global state
    ├── routes/       Route definitions and guards
    ├── validators/   Form and input validation schemas
    ├── types/        Shared types and DTOs
    ├── constants/    Enums, roles, config values, route paths
    ├── utils/        Pure helpers
    ├── styles/       Global styles, theme, design tokens
    ├── assets/       Images, fonts, icons
    └── tests/        Test setup and shared helpers
```

## Why feature-based

Grouping by technical type (`all components/`, `all hooks/`) means one product change touches
five distant folders and no folder tells you what the app does. Grouping by feature means a
change to checkout is a change inside `features/checkout/`, and the folder listing reads like
a description of the product.

A feature slice:

```
features/orders/
├── components/       Components only this feature uses
├── hooks/            Hooks only this feature uses
├── api/              This feature's endpoint calls
├── types/            This feature's types
├── validators/       This feature's form schemas
├── store/            This feature's state, if any
└── index.js          The feature's public surface
```

## Rules

**A feature exports through its `index.js`.** Other features import from
`features/orders`, never from `features/orders/components/OrderRow`. Deep imports harden into
coupling that makes the feature impossible to move or delete.

**Features do not import from each other.** If two features need the same thing, it belongs in
the shared layer — `components/`, `hooks/`, `utils/`. Cross-feature imports are how a modular
frontend quietly becomes a monolith.

**`components/` holds presentational components only.** No data fetching, no business rules.
A shared component receives props and renders; that is what makes it shared.

**Pages are thin.** A page composes a layout and a feature. Logic sitting in a page is logic
that cannot be tested without a router.

**All HTTP goes through `api/`.** One client with one place for base URL, auth headers,
timeouts, error normalization, and refresh handling. Scattered `fetch` calls mean auth or
error handling gets fixed in some places and not others.

**Route paths are constants.** A path typed as a string literal in two files will diverge.

## State

Prefer local state; lift only when genuinely shared. Server data belongs in a data-fetching
layer (React Query or equivalent) rather than global state — caching, refetching, and
staleness are already solved there, and hand-rolling them into a global store is a common
source of bugs.

Reserve `store/` for genuine client state: auth session, theme, UI preferences.
