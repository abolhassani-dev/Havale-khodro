# havale — frontend

Feature-based architecture: code that changes together lives together.

## Layout

- `features/` — self-contained domains, each exporting through its `index.js`
- `components/` — shared presentational components, no business logic
- `pages/` — thin route entry points composing a layout and a feature
- `api/` — the single HTTP client, interceptors, and error normalization
- `store/` — global client state only; server data belongs in a data-fetching layer

## Rules

Features import from other features only through the public `index.js`, and ideally not at
all — anything two features need belongs in the shared layer. Deep imports harden into
coupling that makes a feature impossible to move or delete.

Every folder under `src/` has a README describing its responsibility.
